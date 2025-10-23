import express from "express";
import { getFileNetwork } from "./networkComposer";
import { config } from "./config";
import { internalRedirect } from "./http";

const app = express();

app.get("/file/:cid", async (req, res) => {
  const result = await getFileNetwork(req.params.cid);
  console.log("fetching file: ", req.params.cid);
  if (!result) {
    res.status(404).sendFile("404.html", { root: "public" });
    return;
  }

  if (result?.type === "folder") {
    res.redirect(`/folder/${req.params.cid}`);
    return;
  }

  res.setHeader("X-Network", result.network);

  internalRedirect(req, res, result.url).catch((error) => {
    console.error(error);
    res.status(500).send("Internal server error");
  });
});

app.get("/folder/:cid", async (req, res) => {
  const result = await getFileNetwork(req.params.cid);
  if (!result) {
    res.status(404).sendFile("404.html", { root: "public" });
    return;
  }

  if (result?.type === "file") {
    res.redirect(`/file/${req.params.cid}`);
    return;
  }

  res.setHeader("X-Network", result.network);

  internalRedirect(req, res, result.url).catch((error) => {
    console.error(error);
    res.status(500).send("Internal server error");
  });
});

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.get("/health", (req, res) => {
  res.send("OK");
});

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});
