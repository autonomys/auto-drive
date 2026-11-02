-- An organisation has one account. Without a key, concurrent first requests
-- could each create one. Accounts own credits, so duplicates are not deleted
-- here: the migration stops and they have to be merged by hand first.
DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(organization_id || ' (' || n || ' accounts)', ', ')
    INTO duplicates
    FROM (
      SELECT organization_id, count(*) AS n
      FROM public.accounts
      GROUP BY organization_id
      HAVING count(*) > 1
    ) d;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Organizations with more than one account: %. Merge their accounts before running this migration.', duplicates;
  END IF;
END $$;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_organization_id_key UNIQUE (organization_id);
