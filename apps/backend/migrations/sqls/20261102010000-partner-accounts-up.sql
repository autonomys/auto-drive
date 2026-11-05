-- A partner account belongs to a partner organisation and is shared by its
-- members (#888). Partner terms (#890) are set on these accounts.
ALTER TABLE public.accounts
  ADD COLUMN is_partner boolean NOT NULL DEFAULT false;
