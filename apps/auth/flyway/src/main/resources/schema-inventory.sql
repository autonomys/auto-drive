-- Definitions only: never reads auth records or API key values.
SELECT 'column|' || table_name || '|' || column_name || '|' || data_type
       || '|' || is_nullable || '|' || COALESCE(column_default, '') AS definition
FROM information_schema.columns
WHERE table_schema = 'users'
UNION ALL
SELECT 'constraint|' || t.relname || '|' || c.conname || '|'
       || pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'users'
UNION ALL
SELECT 'index|' || t.relname || '|' || i.relname || '|'
       || pg_get_indexdef(i.oid) || '|valid=' || x.indisvalid::text
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'users'
ORDER BY 1;
