-- person-memories.sql  (RECONSTRUCTED from the live database)
-- Table + helper functions + memory RPCs. Run after persons, tree_members, relationships, family_trees exist.
-- Items marked ASSUMED are not visible in the dump (constraints/indexes): compare with a fresh dump if you need exactness.

create table if not exists public.person_memories (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.persons(id) on delete cascade,   -- ASSUMED fk
  author_id  uuid not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists person_memories_person_idx on public.person_memories (person_id, created_at desc);  -- ASSUMED
alter table public.person_memories enable row level security;   -- no policies: access only through the functions below

-- ===== helpers =====
CREATE OR REPLACE FUNCTION public.ft_my_tree_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select tm.tree_id from tree_members tm join persons p on p.id = tm.person_id where p.claimed_by = auth.uid()
  union
  select id from family_trees where owner_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.ft_can_access_person(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from persons p where p.id = p_person and (p.created_by = auth.uid() or p.claimed_by = auth.uid()))
      or exists (select 1 from tree_members tm where tm.person_id = p_person and tm.tree_id in (select public.ft_my_tree_ids()))
      or exists (
           select 1 from relationships r
           where r.status = 'active' and p_person in (r.person_a_id, r.person_b_id)
             and exists (select 1 from tree_members tm2
                         where tm2.person_id in (r.person_a_id, r.person_b_id)
                           and tm2.tree_id in (select public.ft_my_tree_ids())))
$function$;

CREATE OR REPLACE FUNCTION public.ft_can_manage_person(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from persons p where p.id = p_person and p.created_by = auth.uid())
      or exists (select 1 from tree_members tm join family_trees ft on ft.id = tm.tree_id
                 where tm.person_id = p_person and ft.owner_id = auth.uid())
$function$;

-- ===== memories =====
CREATE OR REPLACE FUNCTION public.add_person_memory(p_person_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare mid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.ft_can_access_person(p_person_id) then raise exception 'You cannot write on this profile'; end if;
  if p_body is null or char_length(trim(p_body)) = 0 then raise exception 'Write something first'; end if;
  if char_length(p_body) > 2000 then raise exception 'Memory is too long (max 2000 characters)'; end if;
  insert into person_memories (person_id, author_id, body) values (p_person_id, auth.uid(), trim(p_body))
  returning person_memories.id into mid;
  return mid;
end $function$;

CREATE OR REPLACE FUNCTION public.list_person_memories(p_person_id uuid)
 RETURNS TABLE(id uuid, body text, author_id uuid, author_name text, created_at timestamp with time zone, can_delete boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.ft_can_access_person(p_person_id) then return; end if;
  return query
  select m.id, m.body, m.author_id,
         (select pr.display_name from profiles pr where pr.id = m.author_id),
         m.created_at,
         (m.author_id = auth.uid() or public.ft_can_manage_person(p_person_id))
  from person_memories m
  where m.person_id = p_person_id
  order by m.created_at desc
  limit 200;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_person_memory(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from person_memories m
  where m.id = p_id and (m.author_id = auth.uid() or public.ft_can_manage_person(m.person_id));
$function$;

-- only signed-in users may call these
revoke execute on function public.add_person_memory(uuid, text)   from public, anon;
revoke execute on function public.list_person_memories(uuid)      from public, anon;
revoke execute on function public.delete_person_memory(uuid)      from public, anon;
grant  execute on function public.add_person_memory(uuid, text)   to authenticated;
grant  execute on function public.list_person_memories(uuid)      to authenticated;
grant  execute on function public.delete_person_memory(uuid)      to authenticated;
