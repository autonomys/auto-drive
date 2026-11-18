-- S3 lists keys in UTF-8 byte order, and ListObjectsV2 resumes a delimiter
-- listing from "<prefix>" + U+FFFF on the assumption that it sorts after every
-- key under that prefix. Under a linguistic database collation it does not
-- (en_US.utf8 puts 'd/' + U+FFFF before 'd/000'), so the next page returned the
-- same rows and the same token again, without end (#963). It also interleaves
-- a folder's keys with similarly named ones ('photos/a.jpg', 'photos.zip',
-- 'photos/z.jpg'), so a paged delimiter listing could return a folder twice.
--
-- object_versions changes too so that ListObjectVersions, which pages by key
-- the same way, keeps the order ListObjectsV2 has. Neither table is rewritten,
-- but every index containing "key" is rebuilt under an ACCESS EXCLUSIVE lock.
ALTER TABLE "S3".object_mappings ALTER COLUMN "key" TYPE text COLLATE "C";
ALTER TABLE "S3".object_versions ALTER COLUMN "key" TYPE text COLLATE "C";
