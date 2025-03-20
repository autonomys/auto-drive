import express from "express";
import { getFileNetwork } from "./networkComposer";
import { config } from "./config";
import { internalRedirect } from "./http";
import spdy from "spdy";

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

spdy
  .createServer(
    {},
    {
      spdy: {
        protocols: ["h2", "http/1.1"],
      },
    },
    app
  )
  .listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
  });
