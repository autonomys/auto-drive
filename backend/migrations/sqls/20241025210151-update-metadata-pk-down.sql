ALTER TABLE metadata DROP CONSTRAINT metadata_pkey;
ALTER TABLE metadata ADD PRIMARY KEY (head_cid);
