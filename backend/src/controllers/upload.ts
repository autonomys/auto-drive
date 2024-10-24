import { Router } from "express";
import { handleAuth } from "../services/authManager/express.js";
import { UploadsUseCases } from "../useCases/uploads/uploads.js";
import multer from "multer";

const uploadController = Router();

uploadController.post("/file", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { mimeType, filename } = req.body;

  if (typeof filename !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid field: filename" });
  }

  if (typeof mimeType !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid field: mimeType" });
  }

  try {
    const upload = await UploadsUseCases.createFileUpload(
      user,
      filename,
      mimeType
    );

    return res.status(200).json(upload);
  } catch (error) {
    console.log(error);

    return res.status(500).json({ error: "Failed to create upload" });
  }
});

uploadController.post("/folder", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }
  const { fileTree, name } = req.body;

  try {
    const upload = await UploadsUseCases.createFolderUpload(
      user,
      name,
      fileTree
    );

    return res.status(200).json(upload);
  } catch (error) {
    return res.status(500).json({ error: "Failed to create upload" });
  }
});

uploadController.post("/folder/:uploadId/file", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  const { uploadId } = req.params;
  const { name, mimeType, relativeId } = req.body;

  if (typeof name !== "string") {
    return res.status(400).json({ error: "Missing or invalid field: name" });
  }

  if (typeof mimeType !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid field: mimeType" });
  }

  if (typeof relativeId !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid field: relativeId" });
  }

  try {
    const upload = await UploadsUseCases.createFileInFolder(
      user,
      uploadId,
      relativeId,
      name,
      mimeType
    );

    return res.status(200).json(upload);
  } catch (error) {
    return res.status(500).json({ error: "Failed to create file in folder" });
  }
});

uploadController.post(
  "/file/:uploadId/chunk",
  multer().single("file"),
  async (req, res) => {
    const user = await handleAuth(req, res);
    if (!user) {
      return;
    }
    const { uploadId } = req.params;
    const chunk = req.file?.buffer;
    let { index } = req.body;

    if (!chunk) {
      return res.status(400).json({
        error: "Missing chunk: expected formData entry in field `file`",
      });
    }

    index = parseInt(index);
    if (isNaN(index)) {
      return res.status(400).json({ error: "Invalid index" });
    }

    try {
      await UploadsUseCases.uploadChunk(user, uploadId, index, chunk);

      return res.status(200).json({ message: "Chunk uploaded" });
    } catch (error) {
      console.log(error);

      return res.status(500).json({ error: "Failed to upload chunk" });
    }
  }
);

uploadController.post("/:uploadId/complete", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }
  const { uploadId } = req.params;

  throw new Error("Not implemented");
});

uploadController.post("/:uploadId/cancel", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }
  const { uploadId } = req.params;

  throw new Error("Not implemented");
});

uploadController.get("/:uploadId", async (req, res) => {
  const user = await handleAuth(req, res);
  if (!user) {
    return;
  }

  throw new Error("Not implemented");
});

export { uploadController };
