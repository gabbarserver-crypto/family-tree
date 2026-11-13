-- FamilyTree fix: relationships.created_at must never be NULL.
-- Run this once in Supabase SQL Editor.
alter table public.relationships
  alter column created_at set default now();

create or replace function public.ft_set_relationship_created_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_at is null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_relationships_created_at on public.relationships;
create trigger trg_relationships_created_at
before insert on public.relationships
for each row
execute function public.ft_set_relationship_created_at();
