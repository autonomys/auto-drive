DROP TRIGGER IF EXISTS set_timestamp ON uploads.uploads;
DROP TRIGGER IF EXISTS set_timestamp ON uploads.file_parts;
DROP TRIGGER IF EXISTS set_timestamp ON uploads.blockstore;
DROP TRIGGER IF EXISTS set_timestamp ON uploads.file_processing_info;

DROP TABLE IF EXISTS uploads.file_processing_info;
DROP TABLE IF EXISTS uploads.blockstore;
DROP TABLE IF EXISTS uploads.file_parts;
DROP TABLE IF EXISTS uploads.uploads;

DROP SCHEMA IF EXISTS uploads;
