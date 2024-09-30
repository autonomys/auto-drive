import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import multer from "multer";
import { isJson } from "./utils/index.js";

import {
  cidToString,
  IPLDNodeData,
  OffchainMetadata,
} from "@autonomys/auto-drive";
import { decode } from "@ipld/dag-pb";
import "dotenv/config.js";
import { FolderTreeSchema, NodeWithMetadata } from "./models/index.js";
import { transactionResultsRepository } from "./repositories/index.js";
import { handleAuth } from "./services/authManager/express.js";
import { uploadManager } from "./services/uploadManager/index.js";
import {
  FilesUseCases,
  MetadataUseCases,
  NodesUseCases,
  TransactionResultsUseCases,
} from "./useCases/index.js";

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
  const port = Number(process.env.PORT) || 3000;

  // Increase the limit to 10MB (adjust as needed)
  const requestSizeLimit = process.env.REQUEST_SIZE_LIMIT || "10mb";
  app.use(bodyParser.json({ limit: requestSizeLimit }));
  app.use(bodyParser.urlencoded({ limit: requestSizeLimit, extended: true }));
  process.env.CORS_ALLOW_ORIGINS &&
    app.use(cors({ origin: process.env.CORS_ALLOW_ORIGINS }));

  app.post("/upload-file", async (req, res) => {
    try {
      const { data, filename, mimeType } = req.body;
      if (!data) {
        return res.status(400).json({ error: "Field `data` is required" });
      }

      const user = await handleAuth(req, res);
      if (!user) {
        return;
      }

      const buffer = Buffer.from(data, "base64");
      const cid = await FilesUseCases.uploadFile(
        user,
        buffer,
        filename,
        mimeType
      );

      res.json({ cid });
    } catch (error) {
      console.error("Error processing data:", error);
      res.status(500).json({ error: "Failed to process and submit data" });
    }
  });

  app.post("/upload-folder", multer().any(), async (req, res) => {
    try {
      const user = await handleAuth(req, res);
      if (!user) {
        return;
      }

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

      const cid = await FilesUseCases.uploadTree(
        user,
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
    const encodedNode = await NodesUseCases.getNode(cid);
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

      const metadata = await MetadataUseCases.getMetadata(cid);
      if (!metadata) {
        return res.status(404).json({ error: "Metadata not found" });
      }

      console.log(`Attempting to retrieve data for metadataCid: ${cid}`);
      const data = await FilesUseCases.retrieveAndReassembleData(cid);

      setContentTypeHeaders(res, metadata);
      res.send(data);
    } catch (error: any) {
      console.error("Error retrieving data:", error);
      res
        .status(500)
        .json({ error: "Failed to retrieve data", details: error.message });
    }
  });

  app.get("/metadata/search/:cid", async (req, res) => {
    try {
      const { cid } = req.params;
      const { scope } = req.query;

      const user = await handleAuth(req, res);
      if (!user) {
        return;
      }

      const limit = req.query.limit
        ? parseInt(req.query.limit as string)
        : undefined;
      const results = await MetadataUseCases.searchMetadataByCID(
        cid,
        limit,
        user && scope === "user" ? { user, scope } : { scope: "global" }
      );
      res.json(results);
    } catch (error: any) {
      console.error("Error searching metadata:", error);
      res
        .status(500)
        .json({ error: "Failed to search metadata", details: error.message });
    }
  });

  app.get("/metadata/roots", async (req, res) => {
    const user = await handleAuth(req, res);
    const { scope } = req.query;
    if (!user) {
      return;
    }

    const roots = await MetadataUseCases.getRootObjects(
      user && scope === "user" ? { user, scope } : { scope: "global" }
    );
    res.json(roots);
  });

  app.get("/metadata/:cid", async (req, res) => {
    try {
      const { cid } = req.params;
      const metadata = await MetadataUseCases.getMetadata(cid);
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
      const transactionResult =
        await TransactionResultsUseCases.getNodeTransactionResult(cid);
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
      const transactionResults =
        await TransactionResultsUseCases.getHeadTransactionResults(cid);

      if (!transactionResults) {
        return res.status(404).json({ error: "Transaction result not found" });
      }

      const remarks = await Promise.all(
        transactionResults.map((result) =>
          TransactionResultsUseCases.retrieveRemarkFromTransaction(result)
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
