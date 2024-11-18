CREATE SCHEMA IF NOT EXISTS download_cache;

CREATE TABLE IF NOT EXISTS download_cache.file_parts (
    "cid" TEXT PRIMARY KEY,
    "index" INTEGER NOT NULL,
    "data" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_cache.registry (
    "cid" TEXT PRIMARY KEY,
    "last_accessed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "size" BIGINT NOT NULL
);
