-- A caller's own reference for the customer an upload was made for (#892).
-- Set when the upload is created, so its children in a folder upload inherit
-- it, and copied onto the interactions the upload is charged as. NULL when the
-- caller gave none. Adding a nullable column without a default does not
-- rewrite either table.
SET LOCAL lock_timeout = '5s';
ALTER TABLE uploads.uploads ADD COLUMN customer_reference text;
ALTER TABLE public.interactions ADD COLUMN customer_reference text;
