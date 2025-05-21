CREATE TABLE public.async_downloads (
    id text NOT NULL,
    oauth_provider text NOT NULL,
    oauth_user_id text NOT NULL,
    cid text NOT NULL,
    status text NOT NULL,
    error_message text NULL,
    file_size int8 NULL,
    downloaded_bytes int8 NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT async_downloads_pkey PRIMARY KEY (id),
    CONSTRAINT fk_user_id FOREIGN KEY (oauth_provider, oauth_user_id) REFERENCES public.users(oauth_provider, oauth_user_id)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    public.async_downloads for each row execute function trigger_set_timestamp();

-- Index for faster lookups by user

CREATE INDEX idx_downloads_user ON public.async_downloads USING btree (oauth_provider, oauth_user_id);

-- Index for faster lookups by CID

CREATE INDEX idx_downloads_cid ON public.async_downloads USING btree (cid);
