-- Activity Log for tree owners / admins: ALL edits of the whole tree, with filters.
-- Run once in the Supabase SQL editor AFTER supabase-edit-log.sql (needs person_edit_log and public._is_tree_admin).
-- Only a tree owner or admin can call these functions (checked inside, with _is_tree_admin).

-- All changes in a tree, newest first. Filters are optional. For "Load more" pass created_at AND id of the last row you already have.
create or replace function public.list_tree_edit_log(
  p_tree_id uuid,
  p_person  uuid        default null,
  p_actor   uuid        default null,
  p_action  text        default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null,
  p_before  timestamptz default null,
  p_before_id uuid      default null,
  p_limit   int         default 50)
returns table (id uuid, person_id uuid, person_name text, actor_id uuid, actor_name text, action text, changes jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public._is_tree_admin(p_tree_id) then
    raise exception 'Only a tree owner or admin can see the activity log';
  end if;
  return query
  with scoped as (
    select l.*, pp.full_name as pname,
           -- a relationship change is logged on BOTH people; keep one copy
           row_number() over (partition by l.actor_id, l.action, l.created_at, l.changes::text order by l.id) as rn
    from public.person_edit_log l
    join public.tree_members tm on tm.person_id = l.person_id and tm.tree_id = p_tree_id
    join public.persons pp on pp.id = l.person_id
  )
  select s.id, s.person_id, s.pname, s.actor_id, s.actor_name, s.action, s.changes, s.created_at
  from scoped s
  where (s.action not like 'relationship%' or s.rn = 1)
    and (p_person is null or s.person_id = p_person)
    and (p_actor  is null or s.actor_id  = p_actor)
    and (p_action is null or s.action    = p_action)
    and (p_from   is null or s.created_at >= p_from)
    and (p_to     is null or s.created_at <  p_to)
    and (p_before is null or s.created_at < p_before or (s.created_at = p_before and p_before_id is not null and s.id < p_before_id))
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- people who made changes (for the "Who" filter)
create or replace function public.list_tree_edit_actors(p_tree_id uuid)
returns table (actor_id uuid, actor_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public._is_tree_admin(p_tree_id) then
    raise exception 'Only a tree owner or admin can see the activity log';
  end if;
  return query
  select distinct on (l.actor_id) l.actor_id, coalesce(l.actor_name, 'Family member')
  from public.person_edit_log l
  join public.tree_members tm on tm.person_id = l.person_id and tm.tree_id = p_tree_id
  where l.actor_id is not null
  order by l.actor_id, l.created_at desc;
end $$;

-- bell badge: changes made by OTHER people since p_since
create or replace function public.count_tree_edit_log_since(p_tree_id uuid, p_since timestamptz)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare n bigint;
begin
  if auth.uid() is null or not public._is_tree_admin(p_tree_id) then return 0; end if;
  select count(*) into n from (
    select 1
    from public.person_edit_log l
    join public.tree_members tm on tm.person_id = l.person_id and tm.tree_id = p_tree_id
    where l.created_at > coalesce(p_since, 'epoch'::timestamptz)
      and l.actor_id is distinct from auth.uid()
      and l.action <> 'created'
    group by case when l.action like 'relationship%' then l.actor_id::text || l.action || l.created_at::text || l.changes::text else l.id::text end
  ) x;
  return n;
end $$;

grant execute on function public.list_tree_edit_log(uuid, uuid, uuid, text, timestamptz, timestamptz, timestamptz, uuid, int) to authenticated;
grant execute on function public.list_tree_edit_actors(uuid) to authenticated;
grant execute on function public.count_tree_edit_log_since(uuid, timestamptz) to authenticated;
