CREATE TABLE notifications (
    public_id text NOT NULL PRIMARY KEY,
    listening_notification_ids text[] NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

