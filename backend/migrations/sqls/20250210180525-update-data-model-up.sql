ALTER TABLE nodes ADD COLUMN block_published_on INTEGER;
ALTER TABLE nodes ADD COLUMN tx_published_on TEXT;

DO $$ 
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN (SELECT cid, transaction_result FROM public.transaction_results) LOOP
        UPDATE nodes
        SET published_on = rec.transaction_result
        WHERE cid = rec.cid;
    END LOOP;
END $$;
