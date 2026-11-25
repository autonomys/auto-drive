-- The https origins of partners' apps, each belonging to one partner
-- organisation. Wallet sign-ins for one are accepted only from that
-- organisation's end users, who sign in for nothing else. They are kept in
-- the database, not in config, because an organisation's end users, removed
-- ones included, can sign in only through them: an origin is never removed
-- while its organisation has any.
--
-- Production runs on Aurora DSQL: this is the whole migration there.
CREATE TABLE users.partner_origins (
  origin text PRIMARY KEY,
  organization_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT NOW()
);
