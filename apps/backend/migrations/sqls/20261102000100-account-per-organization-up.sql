-- An organisation has one account. Without a key, concurrent first requests
-- could each create one. Fails if an organisation already has more than one:
-- merge those accounts first (see PR #932).
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_organization_id_key UNIQUE (organization_id);
