-- =====================================================================================
-- Deleted-profile Trash: every deleted profile is copied (with its relationships and tree membership) into
-- public.deleted_persons BEFORE it disappears. That copy can NOT be deleted by anyone through the app or the API
-- (a database trigger blocks DELETE). The tree OWNER can restore a profile; owner + admins can see the list.
-- Run once in the Supabase SQL editor (needs _is_tree_admin / tree_access from supabase-join-tree.sql).
-- =====================================================================================
create table if not exists public.deleted_persons (
  id               uuid primary key default gen_random_uuid(),
  tree_id          uuid not null,                       -- deliberately no FK: deleting a tree must not erase this copy
  person_id        uuid not null,
  person           jsonb not null,                      -- the complete persons row
  relationships    jsonb not null default '[]'::jsonb,  -- every relationship row that touched this person
  tree_member      jsonb,                               -- the tree_members row
  was_soft_deleted boolean not null default false,
  deleted_by       uuid,
  deleted_by_name  text,
  deleted_at       timestamptz not null default now(),
  restored_at      timestamptz,
  restored_by      uuid
);
create index if not exists deleted_persons_tree_idx on public.deleted_persons (tree_id, deleted_at desc);
create index if not exists deleted_persons_person_idx on public.deleted_persons (person_id);
alter table public.deleted_persons enable row level security;       -- no policies: reachable only through the functions below
revoke all on public.deleted_persons from anon, authenticated;

-- nobody can delete a trash row, and the only allowed update is "mark as restored"
create or replace function public._trash_protect() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Deleted profiles are kept permanently and cannot be removed'; end if;
  if (to_jsonb(new) - 'restored_at' - 'restored_by') is distinct from (to_jsonb(old) - 'restored_at' - 'restored_by') then
    raise exception 'A trash record cannot be edited';
  end if;
  return new;
end $$;
drop trigger if exists trash_protect on public.deleted_persons;
create trigger trash_protect before update or delete on public.deleted_persons for each row execute function public._trash_protect();

-- ---- take the copy (used by the app just before it deletes, and by the safety-net trigger below) ----
create or replace function public._trash_snapshot(p_tree uuid, p_person uuid, p_soft boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_p jsonb; v_rels jsonb; v_tm jsonb;
begin
  select to_jsonb(x) into v_p from public.persons x where x.id = p_person;
  if v_p is null then return; end if;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rels from public.relationships r
    where r.tree_id = p_tree and (r.person_a_id = p_person or r.person_b_id = p_person);
  select to_jsonb(t) into v_tm from public.tree_members t where t.tree_id = p_tree and t.person_id = p_person;
  insert into public.deleted_persons (tree_id, person_id, person, relationships, tree_member, was_soft_deleted, deleted_by, deleted_by_name)
  values (p_tree, p_person, v_p, v_rels, v_tm, p_soft, auth.uid(), public._log_actor_name());
end $$;
revoke all on function public._trash_snapshot(uuid, uuid, boolean) from public, anon, authenticated;

-- ---- called by the app right before deleting: only tree owner/admin, or the creator of an unclaimed profile ----
create or replace function public.trash_person(p_tree_id uuid, p_person_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_creator uuid; v_claimed uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select created_by, claimed_by into v_creator, v_claimed from public.persons where id = p_person_id;
  if not found then return; end if;
  if v_claimed = auth.uid() then raise exception 'You cannot delete your own profile here'; end if;
  if not (public._is_tree_admin(p_tree_id) or (v_claimed is null and v_creator = auth.uid())) then
    raise exception 'You are not allowed to delete this profile';
  end if;
  perform public._trash_snapshot(p_tree_id, p_person_id, false);
end $$;
revoke all on function public.trash_person(uuid, uuid) from public;
grant execute on function public.trash_person(uuid, uuid) to authenticated;

-- ---- safety net: any real DELETE of a persons row (SQL editor, other code) is copied too, if the app did not already ----
create or replace function public._trash_on_person_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare t record;
begin
  for t in select distinct tm.tree_id from public.tree_members tm where tm.person_id = old.id loop
    if not exists (select 1 from public.deleted_persons d where d.person_id = old.id and d.tree_id = t.tree_id and d.restored_at is null and d.deleted_at > now() - interval '10 minutes') then
      perform public._trash_snapshot(t.tree_id, old.id, false);
    end if;
  end loop;
  return old;
end $$;
drop trigger if exists trash_on_person_delete on public.persons;
create trigger trash_on_person_delete before delete on public.persons for each row execute function public._trash_on_person_delete();

-- ---- list (owner + admins) ----
create or replace function public.list_deleted_persons(p_tree_id uuid)
returns table (id uuid, person_id uuid, name text, person_code text, dob date, gender text, deleted_by_name text, deleted_at timestamptz,
               restored_at timestamptz, rel_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public._is_tree_admin(p_tree_id) then raise exception 'Only a tree owner or admin can see deleted profiles'; end if;
  return query
  select d.id, d.person_id, d.person ->> 'full_name', d.person ->> 'person_code', nullif(d.person ->> 'dob', '')::date, d.person ->> 'gender',
         d.deleted_by_name, d.deleted_at, d.restored_at, jsonb_array_length(d.relationships)
  from public.deleted_persons d where d.tree_id = p_tree_id order by d.deleted_at desc limit 300;
end $$;
revoke all on function public.list_deleted_persons(uuid) from public;
grant execute on function public.list_deleted_persons(uuid) to authenticated;

-- ---- copy one jsonb row back into a table (skips generated / search columns) ----
create or replace function public._trash_put(p_table regclass, p_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cols text;
begin
  select string_agg(quote_ident(a.attname), ',') into cols
    from pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and p_row ? a.attname;
  execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict do nothing', p_table, cols, cols, p_table) using p_row;
end $$;
revoke all on function public._trash_put(regclass, jsonb) from public, anon, authenticated;

-- ---- restore: TREE OWNER ONLY ----
create or replace function public.restore_deleted_person(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deleted_persons%rowtype; r jsonb; exists_now boolean;
begin
  select * into d from public.deleted_persons where id = p_id;
  if not found then raise exception 'Deleted record not found'; end if;
  if auth.uid() is null or public.tree_access(d.tree_id) <> 'owner' then raise exception 'Only the tree owner can restore deleted profiles'; end if;
  if d.restored_at is not null then raise exception 'Already restored'; end if;

  select exists (select 1 from public.persons where id = d.person_id) into exists_now;
  if exists_now then   -- it was only hidden ("soft delete"): un-hide it
    update public.persons set details = coalesce(details, '{}'::jsonb) - 'deleted' - 'deleted_at' where id = d.person_id;
    update public.relationships set status = 'active'
      where id in (select (x ->> 'id')::uuid from jsonb_array_elements(d.relationships) x) and status = 'removed';
  else
    perform public._trash_put('public.persons', d.person);
  end if;
  if d.tree_member is not null then perform public._trash_put('public.tree_members', d.tree_member); end if;
  for r in select * from jsonb_array_elements(d.relationships) loop
    if exists (select 1 from public.persons where id = (r ->> 'person_a_id')::uuid)
       and exists (select 1 from public.persons where id = (r ->> 'person_b_id')::uuid) then
      perform public._trash_put('public.relationships', r);
    end if;
  end loop;
  update public.deleted_persons set restored_at = now(), restored_by = auth.uid() where id = p_id;
end $$;
revoke all on function public.restore_deleted_person(uuid) from public;
grant execute on function public.restore_deleted_person(uuid) to authenticated;
