import express from "express";
import { getFileNetwork } from "./networkComposer";
import { config } from "./config";
import { internalRedirect } from "./http";

const app = express();

app.get("/file/:cid", async (req, res) => {
  const result = await getFileNetwork(req.params.cid);
  if (!result) {
    res.status(404).send("Folder not found");
    return;
  }

  if (result?.type === "folder") {
    res.redirect(`/folder/${req.params.cid}`);
    return;
  }

  internalRedirect(req, res, result.url);
});

app.get("/folder/:cid", async (req, res) => {
  const result = await getFileNetwork(req.params.cid);
  if (!result) {
    res.status(404).send("Folder not found");
    return;
  }

  if (result?.type === "file") {
    res.redirect(`/file/${req.params.cid}`);
    return;
  }

  internalRedirect(req, res, result.url);
});

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});
