-- Attribution for the consumption ledger (#891): which API key made each
-- interaction, and which purchased credit batches each upload drew from.

-- interactions.id has always been a v4 UUID written by the application but was
-- never declared a key, so nothing could reference it.
ALTER TABLE public.interactions
  ADD CONSTRAINT interactions_pkey PRIMARY KEY (id);

-- NULL for browser sessions and for everything recorded before this shipped.
ALTER TABLE public.interactions ADD COLUMN api_key_id text NULL;

-- Bytes one interaction drew from one batch. Written in the same transaction
-- that decrements purchased_credits, so a batch's consumed bytes always equal
-- the sum of its rows here (for batches granted after this shipped).
CREATE TABLE public.interaction_credit_consumption (
  interaction_id text NOT NULL REFERENCES public.interactions(id),
  purchased_credit_id uuid NOT NULL REFERENCES public.purchased_credits(id),
  bytes int8 NOT NULL CHECK (bytes > 0),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (interaction_id, purchased_credit_id)
);

CREATE INDEX interaction_credit_consumption_purchased_credit_id_idx
  ON public.interaction_credit_consumption (purchased_credit_id);
