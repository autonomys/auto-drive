-- CreateTable
CREATE TABLE "metadata" (
    "root_cid" TEXT NOT NULL,
    "head_cid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tags" TEXT[],

    CONSTRAINT "metadata_pkey" PRIMARY KEY ("head_cid")
);

-- CreateTable
CREATE TABLE "object_ownership" (
    "cid" TEXT NOT NULL,
    "oauth_provider" TEXT NOT NULL,
    "oauth_user_id" TEXT NOT NULL,
    "is_admin" BOOLEAN NOT NULL,
    "marked_as_deleted" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_ownership_pkey" PRIMARY KEY ("cid","oauth_provider","oauth_user_id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "cid" TEXT NOT NULL,
    "root_cid" TEXT NOT NULL,
    "head_cid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "encoded_node" TEXT NOT NULL,
    "piece_index" INTEGER,
    "piece_offset" INTEGER,
    "block_published_on" INTEGER,
    "tx_published_on" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("cid")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "granularity" TEXT NOT NULL,
    "upload_limit" BIGINT NOT NULL,
    "download_limit" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_objects" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads.uploads" (
    "id" TEXT NOT NULL,
    "root_upload_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads.uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads.file_parts" (
    "upload_id" TEXT NOT NULL,
    "part_index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads.file_parts_pkey" PRIMARY KEY ("upload_id","part_index")
);

-- CreateTable
CREATE TABLE "uploads.file_processing_info" (
    "upload_id" TEXT NOT NULL,
    "last_processed_part_index" INTEGER,
    "pending_bytes" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads.file_processing_info_pkey" PRIMARY KEY ("upload_id")
);

-- CreateTable
CREATE TABLE "uploads.blockstore" (
    "upload_id" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "node_size" BIGINT NOT NULL,
    "data" BYTEA NOT NULL,
    "sort_id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads.blockstore_pkey" PRIMARY KEY ("upload_id","cid")
);

-- AddForeignKey
ALTER TABLE "object_ownership" ADD CONSTRAINT "object_ownership_cid_fkey" FOREIGN KEY ("cid") REFERENCES "metadata"("head_cid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_head_cid_fkey" FOREIGN KEY ("head_cid") REFERENCES "metadata"("head_cid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads.file_parts" ADD CONSTRAINT "uploads.file_parts_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads.uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads.file_processing_info" ADD CONSTRAINT "uploads.file_processing_info_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads.uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads.blockstore" ADD CONSTRAINT "uploads.blockstore_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads.uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updated_at" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_uploads_uploads_updated_at
BEFORE UPDATE ON "uploads.uploads"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER update_uploads_file_parts_updated_at
BEFORE UPDATE ON "uploads.file_parts"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER update_uploads_file_processing_info_updated_at
BEFORE UPDATE ON "uploads.file_processing_info"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER update_uploads_blockstore_updated_at
BEFORE UPDATE ON "uploads.blockstore"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER update_metadata_updated_at
BEFORE UPDATE ON "metadata"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER update_object_ownership_updated_at
BEFORE UPDATE ON "object_ownership"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER update_nodes_updated_at
BEFORE UPDATE ON "nodes"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();    


CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON "subscriptions"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER update_interactions_updated_at
BEFORE UPDATE ON "interactions"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER update_published_objects_updated_at
BEFORE UPDATE ON "published_objects"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

