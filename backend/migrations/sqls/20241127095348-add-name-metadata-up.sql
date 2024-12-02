ALTER TABLE metadata ADD COLUMN name TEXT DEFAULT '';
UPDATE metadata SET "name" = metadata->>'name';