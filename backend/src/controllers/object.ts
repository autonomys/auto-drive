import { Router } from "express";
import multer from "multer";
import { FolderTreeSchema } from "../models/index.js";
import { handleAuth } from "../services/authManager/express.js";
import {
  FilesUseCases,
  MetadataUseCases,
  UploadStatusUseCases,
} from "../useCases/index.js";

const objectController = Router();

objectController.get("/:cid/metadata", async (req, res) => {
  try {
    const { cid } = req.params;
    const metadata = await MetadataUseCases.getMetadata(cid);
    if (!metadata) {
      return res.status(404).json({ error: "Metadata not found" });
    }

    res.json(metadata);
  } catch (error: any) {
    console.error("Error retrieving metadata:", error);
    res
      .status(500)
      .json({ error: "Failed to retrieve metadata", details: error.message });
  }
});

objectController.get("/:cid/status", async (req, res) => {
  const { cid } = req.params;

  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const objectInformation = await UploadStatusUseCases.getUploadStatus(cid);
  res.json(objectInformation);
});

objectController.get("/:cid/download", async (req, res) => {
  try {
    const { cid } = req.params;

    const metadata = await MetadataUseCases.getMetadata(cid);
    if (!metadata) {
      return res.status(404).json({ error: "Metadata not found" });
    }

    console.log(`Attempting to retrieve data for metadataCid: ${cid}`);
    const data = await FilesUseCases.downloadObject(cid);

    if (metadata.type === "file") {
      res.set("Content-Type", metadata.mimeType || "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="${metadata.name}"`);
    } else {
      res.set("Content-Type", "application/zip");
      res.set(
        "Content-Disposition",
        `attachment; filename="${metadata.name}.zip"`
      );
    }
    res.send(data);
  } catch (error: any) {
    console.error("Error retrieving data:", error);
    res
      .status(500)
      .json({ error: "Failed to retrieve data", details: error.message });
  }
});

objectController.get("/:cid", async (req, res) => {
  const { cid } = req.params;

  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const objectInformation = await MetadataUseCases.getObjectInformation(cid);
  res.json(objectInformation);
});

objectController.get("/roots", async (req, res) => {
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

objectController.get("/search", async (req, res) => {
  try {
    const { scope, cid } = req.query;

    const user = await handleAuth(req, res);
    if (!user) {
      return;
    }

    if (typeof cid !== "string") {
      return res.status(400).json({ error: "Missing or invalid cid value" });
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

objectController.post("/file", async (req, res) => {
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

objectController.post("/folder", multer().any(), async (req, res) => {
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

export { objectController };
