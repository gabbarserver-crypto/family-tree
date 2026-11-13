-- Edit log: who changed what on a person's profile, and when.
-- Run once in the Supabase SQL editor (after supabase-person-wall.sql, which provides can_view_person_wall).
-- Logging is done by database triggers, so EVERY edit is recorded no matter which screen or code path made it.
-- History starts from the moment you run this file (older edits cannot be recovered).
-- Phone / e-mail / photo / claim changes are logged as "changed" WITHOUT the old and new values.

create table if not exists public.person_edit_log (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.persons(id) on delete cascade,
  actor_id   uuid,                                  -- deliberately no FK: deleting a user must not erase history
  actor_name text,
  action     text not null check (action in ('created', 'updated', 'relationship_added', 'relationship_removed')),
  changes    jsonb not null default '[]'::jsonb,    -- [{ "field": "...", "old": "...", "new": "..." }]
  created_at timestamptz not null default now()
);
create index if not exists person_edit_log_person_idx on public.person_edit_log (person_id, created_at desc);
alter table public.person_edit_log enable row level security;   -- no policies on purpose: read only via list_person_edit_log()

-- who is acting right now
create or replace function public._log_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 'System'
    else coalesce((select p.full_name from public.persons p where p.claimed_by = auth.uid() limit 1), 'Family member') end;
$$;

-- '' / JSON null / missing all count as "empty", so formatting-only differences are not logged
create or replace function public._log_norm(x jsonb)
returns jsonb language sql immutable as $$
  select case when x is null or x = 'null'::jsonb or x = '""'::jsonb then null else x end;
$$;

-- append one change; sensitive fields keep only the field name
create or replace function public._log_add(changes jsonb, field text, ov jsonb, nv jsonb)
returns jsonb language plpgsql immutable as $$
begin
  if field ~* '(mobile|phone|email|whatsapp|aadhaar|passport|claimed_by|avatar_url)' then
    return changes || jsonb_build_array(jsonb_build_object('field', field));
  end if;
  return changes || jsonb_build_array(jsonb_build_object(
    'field', field,
    'old', case when ov is null then null else left(coalesce(ov #>> '{}', ov::text), 200) end,
    'new', case when nv is null then null else left(coalesce(nv #>> '{}', nv::text), 200) end));
end $$;

-- ===== persons: created / updated =====
create or replace function public._log_person_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; k text; sub text; ov jsonb; nv jsonb; v_changes jsonb := '[]'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.person_edit_log (person_id, actor_id, actor_name, action)
    values (new.id, auth.uid(), public._log_actor_name(), 'created');
    return new;
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  for k in select jsonb_object_keys(v_new) loop
    continue when k in ('id', 'created_at', 'updated_at', 'created_by', 'person_code') or k like '%tsv%' or k like '%search%';
    ov := v_old -> k; nv := v_new -> k;
    if k = 'details' and (jsonb_typeof(ov) = 'object' or jsonb_typeof(nv) = 'object') then
      for sub in
        select distinct jsonb_object_keys(
          (case when jsonb_typeof(ov) = 'object' then ov else '{}'::jsonb end) ||
          (case when jsonb_typeof(nv) = 'object' then nv else '{}'::jsonb end))
      loop
        if public._log_norm(ov -> sub) is distinct from public._log_norm(nv -> sub) then
          v_changes := public._log_add(v_changes, 'details.' || sub, public._log_norm(ov -> sub), public._log_norm(nv -> sub));
        end if;
      end loop;
    elsif public._log_norm(ov) is distinct from public._log_norm(nv) then
      v_changes := public._log_add(v_changes, k, public._log_norm(ov), public._log_norm(nv));
    end if;
  end loop;
  if jsonb_array_length(v_changes) > 0 then
    insert into public.person_edit_log (person_id, actor_id, actor_name, action, changes)
    values (new.id, auth.uid(), public._log_actor_name(), 'updated', v_changes);
  end if;
  return new;
end $$;

drop trigger if exists trg_log_person_change on public.persons;
create trigger trg_log_person_change after insert or update on public.persons
  for each row execute function public._log_person_change();

-- ===== relationships: added / removed (logged on BOTH people) =====
create or replace function public._log_relationship_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record; v_action text; v_a text; v_b text; v_text text;
begin
  if tg_op = 'INSERT' then
    r := new; v_action := case when new.status = 'removed' then null else 'relationship_added' end;
  elsif tg_op = 'DELETE' then
    r := old; v_action := case when old.status = 'removed' then null else 'relationship_removed' end;
  else
    r := new;
    if old.status is distinct from 'removed' and new.status = 'removed' then v_action := 'relationship_removed';
    elsif old.status = 'removed' and new.status is distinct from 'removed' then v_action := 'relationship_added';
    else v_action := null; end if;
  end if;
  if v_action is null then return coalesce(new, old); end if;

  select full_name into v_a from public.persons where id = r.person_a_id;
  select full_name into v_b from public.persons where id = r.person_b_id;
  v_a := coalesce(v_a, 'someone'); v_b := coalesce(v_b, 'someone');
  v_text := case r.relationship_type
    when 'parent' then v_a || ' is parent of ' || v_b
    when 'spouse' then v_a || ' & ' || v_b || ' (spouse)'
    else v_a || ' – ' || v_b || ' (' || r.relationship_type || ')' end;

  -- only for people that still exist (a person being deleted cascades its relationships)
  insert into public.person_edit_log (person_id, actor_id, actor_name, action, changes)
  select pid, auth.uid(), public._log_actor_name(), v_action,
         jsonb_build_array(jsonb_build_object('field', 'Relationship', 'new', v_text))
  from (values (r.person_a_id), (r.person_b_id)) as t(pid)
  where exists (select 1 from public.persons x where x.id = t.pid);
  return coalesce(new, old);
end $$;

drop trigger if exists trg_log_relationship_change on public.relationships;
create trigger trg_log_relationship_change after insert or update or delete on public.relationships
  for each row execute function public._log_relationship_change();

-- ===== read access: anyone who can view this person's wall =====
create or replace function public.list_person_edit_log(p_person_id uuid)
returns table (id uuid, actor_id uuid, actor_name text, action text, changes jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_view_person_wall(p_person_id) then
    raise exception 'No access to this profile';
  end if;
  return query
  select l.id, l.actor_id, l.actor_name, l.action, l.changes, l.created_at
  from public.person_edit_log l
  where l.person_id = p_person_id
  order by l.created_at desc
  limit 200;
end $$;
grant execute on function public.list_person_edit_log(uuid) to authenticated;
