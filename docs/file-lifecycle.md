# File State Lifecycle

A file goes through the following states:

- Processing: The user has finished the upload and the frontend server workers are processing its content
- Publishing: The frontend worker starts publishing the IPLD nodes on-chain
- Archiving: The frontend worker listens to the created object mapping and updates archival data for in `nodes` table
- Archived: The final status

![](https://mermaid.ink/img/pako:eNpFkU1vwjAMhv9K5HOpSvpFc5gE5Ti2adouoxzSxrSZ2qQK6b6A_77QsuGT39jP61g-QqUFAoN9qz-rhhtL7p8LRVwst699q7kgue76Fi2KHZnN7shp7pMHB5EXXrZINrI23EqtTmS1fRrKVh4aqerdZLKaEHpFbvUTybdLUzXy49acT82hTx7Ld6ws6XjfuzJxjEU1Uusr5X4DHtRGCmDWDOhBh6bjFwnHi10BtsEOC2AuFbjnQ2sLKNTZYT1Xb1p3f6TRQ90A2_P24NTQC25xLbnbq_t_NagEmlwPygLLsmA0AXaELycTnwZpnMZxNqdZlHnwDYzG1I9okCyyOKGLIIzCswc_49TAT8M0mmeLKExcFiQeoJBWm810i_Ek51-gvYEb?type=png)

## Details on steps

### 1. Node Table Migration

Gets the nodes from the `uploads.blockstore` and migrates them to `public.nodes`, wiping out any upload artifact like file chunks during multipart uploads.

### 2. Node Publishing

Once migrated, the node publisher receives the nodes to be published. It filters in the ones that were not published already and publish them. In addition it copies the blockchain data for the already published ones, this means that if a node was already published and the onchain publisher receives a message for publishing a node with same cid, the later entry (differentiated mainly by `root_cid` and/or `head_cid`) will have the same `block_published_on` and `tx_published_on` as the first and eventually the same `piece_index` and `piece_offset`.

### 3. Object mapping listening

A file should not be archived until all their IPLD nodes are retrievable, the `objectMappingListener` listens to the object mappings created that are already theoritically accessible (may not be accesible just because piece were not plotted yet but is the best we can do). For every set of object mappings received, updates archival data and then checks if any other of the files were fully archived with the latest updates. If so, it will perform the following operations:

- Populate auto-drive cache using the node in the table
- Marks object as archived using `is_archived` field
- Removes the `encoded_data` field for nodes with removing `root_cid`
