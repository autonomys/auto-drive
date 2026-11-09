-- The account an intent was created for. Its credits are granted to this
-- account, even if the buyer has moved to another organisation since. NULL for
-- intents created before this shipped, which are credited to the buyer's
-- current account as before.
ALTER TABLE public.intents
  ADD COLUMN account_id text NULL REFERENCES public.accounts(id);
