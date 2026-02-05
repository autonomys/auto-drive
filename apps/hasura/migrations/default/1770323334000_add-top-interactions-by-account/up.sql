-- Create a composite type for the result
CREATE TYPE public.top_account_by_interaction AS (
    account_id TEXT,
    total_size BIGINT
);

-- Create a function that returns top accounts by interaction type within a date range
CREATE OR REPLACE FUNCTION public.get_top_accounts_by_interaction(
    interaction_type TEXT,
    from_date TIMESTAMP WITH TIME ZONE,
    to_date TIMESTAMP WITH TIME ZONE,
    result_limit INTEGER DEFAULT 10
)
RETURNS SETOF public.top_account_by_interaction
LANGUAGE sql
STABLE
AS $$
    SELECT 
        account_id,
        SUM(size)::BIGINT as total_size
    FROM public.interactions
    WHERE 
        type = interaction_type
        AND created_at >= from_date
        AND created_at <= to_date
    GROUP BY account_id
    ORDER BY total_size DESC
    LIMIT result_limit;
$$;

