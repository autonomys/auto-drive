-- Drop the recorded purchase size.
--
-- Safe to reverse: quoted_bytes is written at creation and read by nothing that
-- derives credits, so removing it loses the audit record of what a user asked
-- for but changes no balance.

ALTER TABLE intents
  DROP COLUMN IF EXISTS quoted_bytes;
