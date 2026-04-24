# Auto Drive — Download & File Reconstruction

A code-level walkthrough of every place a file can come from when a user downloads a CID, the file-state conditions that determine which source is used, and a detailed description of the two-tier download cache (memory + filesystem) plus the `populate-cache` background job.

All file/line references are relative to the repository root.

---

## 1. Entry points

Downloads are served by a dedicated process (`yarn backend start:download` or the combined `start:download:api` / `start:download:worker`). The API is bootstrapped in `apps/backend/src/app/apis/download.ts` and the routes live in `apps/backend/src/app/controllers/download.ts`.

There are two download flavors:

**Synchronous streaming download** — `GET /downloads/:cid`
(`apps/backend/src/app/controllers/download.ts:90-215`)

1. Parses optional `blockObjectsWithTags`, HTTP `Range` header, and `ignoreEncoding` query flag.
2. Calls `handleOptionalAuth` — an unauthenticated caller is still allowed, but only for files under `config.params.maxAnonymousDownloadSize` (default 100 MiB, `config.ts:97-99`). Anonymous requests for larger files are rejected with `PaymentRequiredError`.
3. Fetches metadata once (without byte range) to decide whether it needs server-side decompression (done for `video/*` and `audio/*` when `metadata.isCompressed && !metadata.isEncrypted`).
4. Calls the use case again, this time passing the byte range (unless decompression is required — then the full file must be materialized first).
5. Opens the stream via `startDownload()` and pipes it to the response. If decompression is needed and the client didn't opt out with `ignoreEncoding=true`, the stream is piped through `zlib.createInflate()` first.

**Async job download** — `POST /downloads/async/:cid` + related routes
(`apps/backend/src/app/controllers/download.ts:46-88, 217-258`)

This creates a row in `async_downloads`, publishes an `async-download-created` task to RabbitMQ, and lets a worker run the full download to completion (used by large-file UX in the frontend). The job logic in `apps/backend/src/core/downloads/async.ts` still calls the same `downloadService.download(cid)`, i.e. it exercises the exact same sources described below — it just drains the stream inside the worker and records progress on the DB row.

**Status probe** — `GET /downloads/:cid/status`
Returns `Cached` vs `NotCached` by checking the two download caches (not whether the file is retrievable).

---

## 2. Authorization and credit accounting

Before any data is read, the use-case layer (`apps/backend/src/core/downloads/sync.ts`) enforces:

- `ObjectUseCases.getMetadata(cid)` — must exist (otherwise `ObjectNotFoundError`).
- Anonymous size cap (see above).
- `ObjectUseCases.authorizeDownload` (`core/objects/object.ts:646-678`): rejects banned content (`IllegalContentError`) or content tagged with any of the caller's `blockingTags` (`NotAcceptableError`).
- **Download credits are *not* enforced right now.** The block is intentionally commented out at `sync.ts:56-68` with a note that the purchased-download flow isn't wired up yet.
- For authenticated users, `AccountsUseCases.registerInteraction` is called with `InteractionType.Download` and the resolved byte length *when the stream actually starts* (inside `startDownload`), so declined requests don't count against usage.

---

## 3. The download service — the heart of the fallback chain

`apps/backend/src/infrastructure/services/download/index.ts` exports a single `downloadService.download(cid, options)` function. This is the only code that produces a stream of file bytes, and it encodes the full source-selection order. In order, it tries:

1. **Memory download cache** (`memoryDownloadCache.get(cid, options)`).
2. **Filesystem cache** (`fsCache.get(cid, options)`).
3. **Source retrieval** (`FilesUseCases.retrieveObject(metadata, options)`).

Whichever branch produces data, the result goes through `downloadService.handleCache`, which forks the stream for write-through caching (details in §6).

```
┌───────────────────────────────────────────────────────────────────────┐
│ downloadService.download(cid, options)                                │
│                                                                       │
│  memoryDownloadCache.get? ──► yes ──► handleCache (skip re-cache)    │
│          │ no                                                         │
│          ▼                                                            │
│  fsCache.get?           ──► yes ──► handleCache (skip re-cache)      │
│          │ no                                                         │
│          ▼                                                            │
│  ObjectUseCases.getMetadata  (fail fast if unknown CID)               │
│          │                                                            │
│          ▼                                                            │
│  FilesUseCases.retrieveObject(metadata, options)                      │
│     │                                                                 │
│     ├── totalSize === 0 ?           → createEmptyReadable()           │
│     ├── no byteRange → retrieveFullFile                               │
│     └── byteRange    → retrieveFileByteRange                          │
│                                                                       │
│     each of those picks a fetcher based on metadata.is_archived:      │
│        is_archived === false → DBObjectFetcher (Postgres nodes)       │
│        is_archived === true  → FileGatewayObjectFetcher (DSN)         │
└───────────────────────────────────────────────────────────────────────┘
```

Note: the cache hits never re-populate themselves (they pass `undefined` for `size` on the memory hit, and `cachedFile.size` on the fs hit), and `handleCache` short-circuits caching entirely when a byte range is requested (see §6).

---

## 4. File state — how it dictates the source

Auto Drive treats an uploaded file as an IPLD DAG of nodes. A file record transitions through several observable states; only one piece of DB state — `metadata.is_archived` — actually changes which retrieval source is used. The other states are visible via `ObjectStatus` (`packages/models/src/objects/object.ts:16-21`: `Processing`, `Publishing`, `Archiving`, `Archived`) but are derived client-side from node counts, not consulted during download.

What matters for retrieval:

**`metadata.is_archived = false`** (file still lives in Postgres `nodes` table).
The DAG is reconstructed locally by `DBObjectFetcher` (`apps/backend/src/core/objects/files/fetchers.ts:16-41`). `fetchNode(cid)` calls `NodesUseCases.getChunkData`, which first tries `nodesRepository.getNode(cid).encoded_node` (base64) and falls back to the upload-processor blockstore for nodes that haven't been migrated yet (`core/objects/nodes.ts:72-100`). No external HTTP calls.

**`metadata.is_archived = true`** (all nodes have been archived by the Autonomys DSN, and their encoded payloads have been purged from Postgres).
The archival handler `ObjectUseCases.onObjectArchived` (`core/objects/object.ts:449-452`) flips `is_archived` and runs `UPDATE nodes SET encoded_node = NULL WHERE root_cid = $1` (`infrastructure/repositories/objects/nodes.ts:179-186`) — Postgres keeps the piece index/offset but discards the bytes. From that point on, `DBObjectFetcher.fetchNode` would return `undefined`, so the code switches to **`FileGatewayObjectFetcher`**, which delegates to the `@autonomys/auto-files` RPC client pointed at `config.filesGateway.url` with `config.filesGateway.token` (`infrastructure/services/dsn/fileGateway/index.ts`). The files-gateway submodule indexes DSN pieces and serves reassembled nodes/files.

The decision is made inside `FilesUseCases` (`core/objects/files/index.ts`):
- `retrieveFullFile` (line 115): `const fetcher = isArchived ? FileGatewayObjectFetcher : DBObjectFetcher`
- `retrieveFileByteRange` (line 78): identical branch

Additional states that do *not* pick a different source but still affect behavior:

- **`Processing` / `Publishing`**: nodes exist in Postgres, archival hasn't finished; served from DB.
- **`Archiving`**: same as above — `is_archived` is still `false` until *all* nodes are archived and `checkObjectsArchivalStatus` enqueues an `object-archived` task (`core/objects/object.ts:543-574`).
- **Banned / blocked**: 406/451 responses before any source is consulted.
- **`totalSize === 0`**: returns `createEmptyReadable()` immediately, skipping all I/O (`core/objects/files/index.ts:131-134`).
- **Folder CID**: both fetchers delegate to `retrieveAndReassembleFolderAsZip` (`core/objects/files/nodeComposer.ts:82-127`) which recursively calls `downloadService.download` on every child file and streams them into a `pizzip` archive. Children go through the full cache→DB→DSN chain individually.

---

## 5. How the file is rebuilt from nodes

A file CID resolves to metadata that includes an ordered list of `chunks` (each chunk is an IPLD node CID). Reconstruction is `composeNodesDataAsFileReadable` (`core/objects/files/nodeComposer.ts:12-80`):

- Single-chunk file: fetch the one node, wrap it as a `Readable`.
- Multi-chunk file: create a `Readable` whose `read()` pulls the next batch of up to `concurrentChunks = 100` chunks in parallel via `fetcher.fetchNode`, pushing each chunk's data onto the stream in order.

For byte-range requests, `retrieveFileByteRange` first walks the chunk list in `getNodesForPartialRetrieval` (`core/objects/files/index.ts:16-76`) to find the *minimum* contiguous slice of chunks that covers `[start, end]`, records the offset of the first covered chunk inside the file, then reassembles only those nodes and slices the resulting `Readable` to the exact byte bounds via `sliceReadable` (`shared/utils/readable.ts`). So partial reads never fetch unneeded nodes from DB or DSN.

The chunk payload itself is obtained in `NodesUseCases.getChunkData` by decoding the IPLD node and returning `chunkData.data` as a `Buffer` (`core/objects/nodes.ts:72-100`).

---

## 6. The cache layer in detail

There are two caches sitting in front of both DB and DSN. They are independent, live in the same process as the download API, and both are populated on every successful full-file download.

### 6.1 Memory download cache

File: `apps/backend/src/infrastructure/services/download/memoryDownloadCache/index.ts`

- Implementation: a single `LRUCache<string, Buffer>` from `lru-cache`, sized by total bytes (`sizeCalculation: value.length`).
- Capacity: `config.memoryDownloadCache.maxCacheSize` bytes, default `1 GiB` (`config.ts:7, 29-33`, env `MEMORY_DOWNLOAD_CACHE_MAX_SIZE`).
- Entire file body is held as one contiguous `Buffer`. Eviction is LRU-by-bytes — when a new entry would push total size past the cap, the least-recently-*used* entries are dropped. `get` counts as a use.
- No TTL. An entry only leaves memory via LRU eviction or a manual `clear()` (exported but not called from the backend today).
- `get(cid, options)` returns `null` on miss; on hit it returns an **async iterable** sliced to the requested byte range (`buffer.subarray(start, end+1)`). This means byte-range reads are served directly from memory without touching the fs cache.
- `set(cid, asyncIterable)` drains the iterable with `asyncIterableToBuffer`, and only stores it if the buffer is non-empty (a safety net against populating the cache with a dead stream).
- Because it serializes the whole file first, the memory cache is not suitable for files larger than the LRU cap — such a file will simply not fit and will be evicted the moment another entry is inserted, so it behaves like "first-come first-evicted" for large items.

### 6.2 Filesystem cache

File: constructed in `apps/backend/src/infrastructure/services/download/index.ts:17-23` via

```ts
const fsCache = createFileCache(
  defaultMemoryAndSqliteConfig({
    cacheMaxSize: config.cache.maxSize,   // env CACHE_MAX_SIZE, default 10 GiB
    cacheTtl:   config.cache.ttl,         // env CACHE_TTL,     default 0 (no TTL)
    dirname:    config.cache.dir,         // env CACHE_DIR,     default ./.cache
  }),
)
```

The implementation lives in `@autonomys/file-server` (`node_modules/@autonomys/file-server/dist/caching/fileCache.js`, config factory `defaultConfigs.js`). It is a two-layer structure:

- **Metadata layer.** A `cache-manager` stack with two stores, queried in order:
  - An in-memory `Keyv`+`LRUCache` (max size = `CACHE_MAX_SIZE`, byte-sized by each entry's stored `size`). Used for fast existence/size lookup.
  - A `Keyv`+`KeyvSqlite` at `<CACHE_DIR>/files/files.sqlite` with `ttl = CACHE_TTL`. This is the persistent index — it survives restarts. A `0` TTL means never expire.
- **Data layer.** Actual file bytes are written to a content-addressed path on disk:
  `<CACHE_DIR>/files/<3-level partitioned path>/<cid>`. With `pathPartitions: 3` and `CHARS_PER_PARTITION = 2`, a CID like `bafy…abcd` becomes `files/cd/ab/fy…/bafy…abcd`. This keeps any one directory from containing millions of entries.

The exposed API used by the backend is:

- `get(cid, options)` — reads the metadata entry; if present, opens an `fs.createReadStream(path, { start, end })` (so byte ranges are served by the kernel), wraps it in `createErrorResilientStream` (30 s stall timeout, 5 s health checks), and returns `{ data, size }`. If the sqlite metadata is present but the file is missing, the read stream will error and the caller in `downloadService.download` logs and falls through to the source.
- `has(cid)` — a pure filesystem existence check (`fsPromises.access`), used by the status endpoint.
- `set(cid, { data, size })` — streams `data` to the partitioned path via `writeFile` (stream write to disk), then writes the metadata entry. The set is an async write-through; if it fails the user download still succeeds (§6.3).
- `remove(cid)` — deletes both the sqlite row and the on-disk file. There is a `filepathCache.on('del')` listener that deletes the on-disk file when an entry is evicted from the in-memory LRU (e.g. to enforce the byte cap).

Unlike the memory cache, the fs cache carries the byte-length in its metadata entry, so byte-range reads served from disk can be bounded without reading the whole file.

### 6.3 Write-through from a live download — `handleCache`

`downloadService.handleCache` (`index.ts:75-136`) is called for every branch — after a source retrieval *and* after a cache hit. Its job is to return a stream the HTTP layer can pipe to the client while asynchronously populating caches from the same producer.

Behavior:

1. **Byte-range requests are never cached.** If `options.byteRange` is set, the stream is returned as-is (with a generic error listener attached), and neither `memoryDownloadCache.set` nor `fsCache.set` is invoked. This is critical because partial streams would corrupt the cache (a future cache hit expects the entire file).
2. **Full reads:** the stream is forked with `forkStream` / `forkAsyncIterable` from `@autonomys/asynchronous`. One branch is returned to the caller; the other is forked a second time so the memory cache and the fs cache each get an independent tee. The two write-through calls run in the background:
   - `memoryDownloadCache.set` drains to a `Buffer` and stores it (empty buffers are dropped).
   - `fsCache.set` writes the stream to the partitioned path and records the size in the sqlite index.
3. Errors on any branch are caught and logged via `handleReadableError` — a caching failure does not break the download stream.

So the effective cache-population rules are:

| Code path                              | memory cache | fs cache |
|----------------------------------------|:------------:|:--------:|
| Cache miss, full download (any source) | **set**      | **set**  |
| Cache hit (memory or fs), full download| re-set       | re-set   |
| Any download with a byte-range         | skipped      | skipped  |
| Cache hit serving a byte-range         | skipped      | skipped  |
| Zero-byte file                         | skipped      | skipped  |

Note that a cache hit re-enters `handleCache` and therefore re-sets the other cache. Practically this means that after a first download, the memory cache will be populated if a later request is still served from the fs cache (the memory set after a memory hit is a no-op for LRU ordering; the fs set after a fs hit rewrites the same bytes).

The `size` passed to the fs cache on a fresh retrieval is `BigInt(metadata.totalSize)` (`index.ts:73`), taken from the stored offchain metadata — so the sqlite size matches the DAG's declared size even before the stream drains.

### 6.4 Proactive cache population — the `populate-cache` task

After an upload is migrated from the per-upload blockstore to the `nodes` table, the backend eagerly warms the download caches so the first user read is fast. Flow:

1. `UploadsUseCases.processMigration` finishes moving nodes into Postgres, removes upload artifacts, and calls `scheduleCachePopulation(cid)` (`core/uploads/uploads.ts:391-405`).
2. `scheduleCachePopulation` publishes a single `populate-cache` task with the root CID (`core/uploads/uploads.ts:381-389`).
3. `EventRouter.publish` routes it to the `download-manager` RabbitMQ queue (`infrastructure/eventRouter/index.ts:33-42`), where the download worker (`app/servers/downloadWorker.ts`) consumes it.
4. The processor dispatches to `ObjectUseCases.populateCaches(cid)` (`infrastructure/eventRouter/processors/download.ts:17-18`).
5. `populateCaches` (`core/objects/object.ts:422-447`):
   - Calls `ObjectUseCases.isReconstructable(cid)` — recursively checks that every leaf chunk in the DAG has a non-null `encoded_node` via `nodesRepository.hasEncodedNode` (`core/objects/object.ts:381-403`, `repositories/objects/nodes.ts:344-352`). If any node is missing (e.g., the upload already started archiving and encoded_nodes have been nulled), it logs and returns *without* priming caches.
   - Otherwise calls `downloadService.download(cid)` (no byte range) and drains the stream with `consumeStream` — which forces the full file through `handleCache`, populating both caches as a side effect.
6. If the processor throws, the task retry logic takes over: tasks carry `retriesLeft` (default `TASK_MANAGER_MAX_RETRIES = 3`, `config.ts:119`), and failed tasks land on the `download-errors` queue.

The `isReconstructable` guard is important: `populateCaches` is the only code that walks the DAG speculatively, so it wouldn't help to download from the DSN here — the node data hasn't even reached the gateway yet if the object isn't published/archived. It's a pre-archive warm-up, *not* a post-archive one.

### 6.5 Cache size / status reporting

- `downloadService.status(cid)` returns `Cached` if either cache reports `has(cid)`, else `NotCached` (`index.ts:137-149`). This is what `GET /downloads/:cid/status` exposes to the UI.
- There is no programmatic invalidation today — the cache does not react to `markAsDeleted`, `onObjectArchived`, or content-ban actions. Once an entry is in the caches, it stays there until LRU eviction (memory) or LRU/TTL eviction (fs).

---

## 7. End-to-end walkthrough: a single download

For an authenticated `GET /downloads/:cid` with no `Range` header and a file that's already archived:

1. `downloadController` parses query and resolves auth.
2. Two calls to `DownloadUseCase.downloadObjectByUser` — first to peek at metadata for the decompression decision, then to produce the real `FileDownload`. Each call runs `getMetadata`, `authorizeDownload`, and registers an interaction only when `startDownload` is invoked.
3. `startDownload()` → `downloadService.download(cid)`.
4. `memoryDownloadCache.get` — miss (cold cache).
5. `fsCache.get` — miss.
6. `ObjectUseCases.getMetadata(cid)` — returns offchain metadata.
7. `FilesUseCases.retrieveObject` → `retrieveFullFile` → `isArchived === true` → `FileGatewayObjectFetcher.fetchFile` → `FileGateway.getFile(cid)` (files-gateway HTTP call over DSN).
8. `handleCache` forks the returned stream: one branch → Express response, second branch → `fsCache.set` + `memoryDownloadCache.set`.
9. Response finishes. Later downloads of the same CID will be served from memory until LRU eviction, then from fs cache.

For a byte-range request on a not-yet-archived file:

1. Same preamble.
2. `memoryDownloadCache.get` — on miss, falls through. On hit, returns a sliced iterable directly from the in-memory `Buffer`.
3. `fsCache.get` passes `byteRange` into `createReadStream({ start, end })`, so only the requested bytes leave disk.
4. On source retrieval, `retrieveFileByteRange` computes the minimum covering chunk window via `getNodesForPartialRetrieval`, uses `DBObjectFetcher` (because `is_archived === false`), and `sliceReadable`s the composed stream.
5. `handleCache` sees `byteRange` and returns the stream without caching — so byte-range-only traffic never pollutes or warms the caches.

---

## 8. Quick source-of-truth index

| Concern | File |
|---|---|
| HTTP routes | `apps/backend/src/app/controllers/download.ts` |
| API bootstrap | `apps/backend/src/app/apis/download.ts` |
| Worker server | `apps/backend/src/app/servers/download.ts` / `downloadWorker.ts` |
| Sync use cases | `apps/backend/src/core/downloads/sync.ts` |
| Async use cases | `apps/backend/src/core/downloads/async.ts` |
| Source-selection and caching | `apps/backend/src/infrastructure/services/download/index.ts` |
| Memory cache | `apps/backend/src/infrastructure/services/download/memoryDownloadCache/index.ts` |
| FS cache (third-party) | `node_modules/@autonomys/file-server/dist/caching/{fileCache,defaultConfigs}.js` |
| DAG reassembly | `apps/backend/src/core/objects/files/{index,nodeComposer,fetchers}.ts` |
| Node storage access | `apps/backend/src/core/objects/nodes.ts`, `infrastructure/repositories/objects/nodes.ts` |
| Archival & `is_archived` | `apps/backend/src/core/objects/object.ts` (`onObjectArchived`, `isArchived`, `checkObjectsArchivalStatus`), `infrastructure/repositories/objects/metadata.ts` |
| DSN gateway client | `apps/backend/src/infrastructure/services/dsn/fileGateway/index.ts` (`@autonomys/auto-files`) |
| Populate-cache task | `core/uploads/uploads.ts` (`scheduleCachePopulation`), `eventRouter/processors/download.ts`, `ObjectUseCases.populateCaches` |
| Task routing / retries | `apps/backend/src/infrastructure/eventRouter/{index,tasks}.ts` |
| Download status model | `packages/models/src/downloads/async.ts` (`DownloadStatus`, `AsyncDownloadStatus`) |
| Object status derivation | `packages/models/src/objects/object.ts` (`objectStatus`, `ObjectStatus`) |
