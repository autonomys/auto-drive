CREATE TABLE published_objects (
    id text PRIMARY KEY,
    public_id text NOT NULL,
    cid text NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_published_objects_public_id ON published_objects(public_id);
CREATE INDEX idx_published_objects_cid ON published_objects(cid);
