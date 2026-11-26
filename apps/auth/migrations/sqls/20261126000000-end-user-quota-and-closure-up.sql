-- Production runs on Aurora DSQL: run each statement in its own transaction,
-- as docs/auth.md lists them.

-- When a partner end user closed their account. Their membership stays, with
-- end_user_removed_at set too, so their customer reference stays reserved and
-- the partner can enrol them again. NULL for everyone else.
ALTER TABLE users.users_organizations ADD COLUMN end_user_closed_at timestamp;

-- What a change did to a partner end user besides moving them
-- ('quota_changed' or 'account_closed'), and their quota after an enrolment or
-- quota change. NULL for every other change.
ALTER TABLE users.organization_membership_changes
  ADD COLUMN end_user_change text;
ALTER TABLE users.organization_membership_changes
  ADD COLUMN upload_quota_bytes bigint;
