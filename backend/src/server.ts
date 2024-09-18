import express from "express";
import cors from "cors";
import multer from "multer";
import bodyParser from "body-parser";
import {
  processFile,
  retrieveAndReassembleData,
} from "./services/storageManager/index.js";
import {
  TransactionResult,
  createApi,
  retrieveRemarkFromTransaction,
} from "./services/transactionManager/index.js";
import { isJson } from "./utils/index.js";

import dotenv from "dotenv";
import { FolderTreeSchema } from "./models/folderTree.js";
import {
  processTree,
  uploadFile,
  uploadTree,
} from "./services/storageManager/storageManager.js";
import {
  cidToString,
  IPLDNodeData,
  OffchainMetadata,
} from "@autonomys/auto-drive";
import { decode } from "@ipld/dag-pb";
import { NodeWithMetadata } from "./models/nodeWithMetadata.js";
import { getNode } from "./api/nodes.js";
import { getMetadata } from "./api/metadata.js";
import {
  getHeadTransactionResults,
  getNodeTransactionResult,
} from "./api/transactionResults.js";
import { uploadManager } from "./services/uploadManager/index.js";
import { transactionResultsRepository } from "./repositories/transactionResults.js";

dotenv.config();

uploadManager.start();

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "ws://localhost:9944";

const setContentTypeHeaders = (
  res: express.Response,
  metadata: OffchainMetadata
) => {
  res.set(
    "Content-Type",
    (metadata.type === "file" && metadata.mimeType) ||
      "application/octet-stream"
  );
  if (metadata.name) {
    console.log(
      `Setting Content-Disposition to attachment with filename: ${metadata.name}`
    );
    res.set("Content-Disposition", `attachment; filename="${metadata.name}"`);
  }
};

const createServer = async () => {
  const app = express();
  const port = 3000;

  // Increase the limit to 10MB (adjust as needed)
  app.use(bodyParser.json({ limit: "10mb" }));
  app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));
  app.use(cors({ origin: "*" }));

  app.post("/upload-file", async (req, res) => {
    try {
      const { data, filename, mimeType } = req.body;
      if (!data) {
        return res.status(400).json({ error: "Field `data` is required" });
      }

      const buffer = Buffer.from(data, "base64");
      const cid = await uploadFile(buffer, filename, mimeType);

      res.json({ cid });
    } catch (error) {
      console.error("Error processing data:", error);
      res.status(500).json({ error: "Failed to process and submit data" });
    }
  });

  app.post("/upload-folder", multer().any(), async (req, res) => {
    try {
      const folderTreeString = req.body.folderTree;
      if (!folderTreeString) {
        return res
          .status(400)
          .json({ error: "Missing folderTree in request body" });
      }

      let parsedFolderTree;
      try {
        parsedFolderTree = JSON.parse(folderTreeString);
      } catch (error) {
        return res.status(400).json({ error: "Invalid JSON in folderTree" });
      }

      const validatedFolderTree = FolderTreeSchema.safeParse(parsedFolderTree);
      if (!validatedFolderTree.success) {
        return res.status(400).json({
          error: "Invalid folder tree structure",
          details: validatedFolderTree.error,
        });
      }

      const cid = await uploadTree(
        validatedFolderTree.data,
        (req.files || []) as Express.Multer.File[]
      );

      console.log(`Processed folder upload with cid: ${cid}`);

      res.json({ cid });
    } catch (error) {
      console.error("Error processing folder upload:", error);
      res.status(500).json({ error: "Failed to process folder upload" });
    }
  });

  app.get("/retrieve/:cid/node", async (req, res) => {
    const { cid } = req.params;
    const encodedNode = await getNode(cid);
    if (!encodedNode) {
      return res.status(404).json({ error: "Node not found" });
    }
    const decodedNode = decode(Buffer.from(encodedNode, "base64"));
    const metadata = decodedNode.Data && IPLDNodeData.decode(decodedNode.Data);

    res.json({
      cid,
      metadata,
      links: decodedNode.Links.map((link) => cidToString(link.Hash)),
    } as NodeWithMetadata);
  });

  app.get("/retrieve/:cid", async (req, res) => {
    try {
      const { cid } = req.params;

      const metadata = await getMetadata(cid);
      if (!metadata) {
        return res.status(404).json({ error: "Metadata not found" });
      }

      console.log(`Attempting to retrieve data for metadataCid: ${cid}`);
      const data = await retrieveAndReassembleData(cid);

      setContentTypeHeaders(res, metadata);
      res.send(data);
    } catch (error: any) {
      console.error("Error retrieving data:", error);
      res
        .status(500)
        .json({ error: "Failed to retrieve data", details: error.message });
    }
  });

  app.get("/metadata/:cid", async (req, res) => {
    try {
      const { cid } = req.params;
      const metadata = await getMetadata(cid);
      if (!metadata) {
        return res.status(404).json({ error: "Metadata not found" });
      }

      const nodesToBeUploaded = (
        await transactionResultsRepository.getPendingUploadsByHeadCid(cid)
      ).length;
      const uploadedNodes = (
        await transactionResultsRepository.getHeadTransactionResults(cid)
      ).length;

      res.json({
        metadata,
        uploadStatus: { nodesToBeUploaded, uploadedNodes },
      });
    } catch (error: any) {
      console.error("Error retrieving metadata:", error);
      res
        .status(500)
        .json({ error: "Failed to retrieve metadata", details: error.message });
    }
  });

  app.get("/transaction/:cid", async (req, res) => {
    try {
      const { cid } = req.params;
      const transactionResult = await getNodeTransactionResult(cid);
      if (!transactionResult) {
        return res.status(404).json({ error: "Transaction result not found" });
      }
      res.json(transactionResult);
    } catch (error: any) {
      console.error("Error retrieving transaction result:", error);
      res.status(500).json({
        error: "Failed to retrieve transaction result",
        details: error.message,
      });
    }
  });

  app.get("/fromTransactions/:cid", async (req, res) => {
    try {
      const { cid } = req.params;
      const transactionResults = await getHeadTransactionResults(cid);

      if (!transactionResults) {
        return res.status(404).json({ error: "Transaction result not found" });
      }

      const api = await createApi(RPC_ENDPOINT);
      const remarks = await Promise.all(
        transactionResults.map((result) =>
          retrieveRemarkFromTransaction(api, result)
        )
      );

      if (remarks.some((remark) => remark === null)) {
        return res
          .status(404)
          .json({ error: "Remarks not found or invalid transaction" });
      }

      if (!remarks[0] || !isJson(remarks[0])) {
        return res.status(400).json({ error: "Invalid metadata format" });
      }

      const metadata: OffchainMetadata = JSON.parse(remarks[0]);

      const data = remarks
        .slice(1)
        .map((remark) => Buffer.from(remark!, "base64"));
      setContentTypeHeaders(res, metadata);
      res.send(Buffer.concat(data));
    } catch (error: any) {
      console.error("Error retrieving remark:", error);
      res
        .status(500)
        .json({ error: "Failed to retrieve remark", details: error.message });
    }
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
};

createServer().catch(console.error);
