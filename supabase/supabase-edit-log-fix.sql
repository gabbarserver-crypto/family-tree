-- Edit-log noise fix: run once in the Supabase SQL editor (after supabase-edit-log.sql).
-- A value like {"date": ""} (an object whose fields are all empty) now counts as "empty", so it is no longer logged as
-- "Marriage removed/added {"date": ""}".
create or replace function public._log_norm(x jsonb)
returns jsonb language sql immutable as $$
  select case
    when x is null or x = 'null'::jsonb or x = '""'::jsonb or x = '{}'::jsonb or x = '[]'::jsonb then null
    when jsonb_typeof(x) = 'object' and not exists (
      select 1 from jsonb_each(x) e where e.value is not null and e.value <> 'null'::jsonb and e.value <> '""'::jsonb
    ) then null
    else x end;
$$;
