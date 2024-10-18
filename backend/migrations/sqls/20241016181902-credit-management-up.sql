CREATE TABLE api_keys (
    id TEXT NOT NULL PRIMARY KEY,
    "secret" TEXT NOT NULL,
    oauth_provider TEXT NOT NULL,
    oauth_user_id TEXT NOT NULL,
    deleted_at TIMESTAMP,
    CONSTRAINT fk_user_id FOREIGN KEY (oauth_provider, oauth_user_id) REFERENCES users(oauth_provider, oauth_user_id)
);


CREATE TABLE organizations (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE users_organizations (
    oauth_provider TEXT NOT NULL,
    oauth_user_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    CONSTRAINT fk_user_id FOREIGN KEY (oauth_provider, oauth_user_id) REFERENCES users(oauth_provider, oauth_user_id),
    CONSTRAINT fk_organization_id FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE subscriptions (
    id TEXT NOT NULL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    granularity TEXT NOT NULL,
    "upload_limit" BIGINT NOT NULL,
    "download_limit" BIGINT NOT NULL,
    CONSTRAINT fk_organization_id FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE interactions (
    id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    CONSTRAINT fk_subscription_id FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);


ALTER TABLE users
ADD COLUMN "role" text NOT NULL DEFAULT 'User';

