-- Destructive: these rows are the only durable record of a refused on-chain
-- payment. Export them before running this if any are unresolved.
DROP TABLE IF EXISTS intent_mispayments;
