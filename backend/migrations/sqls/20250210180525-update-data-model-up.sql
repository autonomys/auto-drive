ALTER TABLE nodes ADD COLUMN block_published_on INTEGER;
ALTER TABLE nodes ADD COLUMN tx_published_on TEXT;

DO $$ 
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN (SELECT cid, transaction_result FROM public.transaction_results) LOOP
        UPDATE nodes
        SET block_published_on = CAST(rec.transaction_result->>'blockNumber' as integer),
            tx_published_on = rec.transaction_result->>'txHash'
        WHERE cid = rec.cid;
    END LOOP;
END $$;
