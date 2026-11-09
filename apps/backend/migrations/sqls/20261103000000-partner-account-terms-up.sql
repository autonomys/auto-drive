-- Per-account overrides of the global credit terms (#890). NULL means use the
-- global default (MAX_CREDITS_PER_USER / CREDIT_EXPIRY_DAYS). They apply to
-- credits granted and purchases made from now on; existing batches keep their
-- expiry.
ALTER TABLE public.accounts
  ADD COLUMN max_purchased_bytes bigint CHECK (max_purchased_bytes > 0),
  ADD COLUMN credit_expiry_days integer CHECK (credit_expiry_days > 0);

-- One row per account term that changed, written in the same transaction as
-- the change.
CREATE TABLE public.account_terms_changes (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.accounts(id),
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_terms_changes_account_id_created_at_idx
  ON public.account_terms_changes (account_id, created_at);
