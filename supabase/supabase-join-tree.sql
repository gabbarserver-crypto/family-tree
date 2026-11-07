-- JOIN A FAMILY TREE  (run once in Supabase -> SQL Editor, after your earlier migrations)
--
-- What this adds
--   1. A new member can PREVIEW the tree that contains a profile ("this is me"), see its admins, and send a JOIN request.
--   2. While the request is PENDING the member can only ADD new profiles/links. They cannot edit or delete anything
--      that existed before (the server enforces this - hiding buttons in the browser is not security).
--   3. When an owner/admin APPROVES, the member may also edit old (unclaimed) profiles.
--   4. When an owner/admin REJECTS (or the member cancels), every profile, link and membership that person added
--      to that tree is rolled back (soft-deleted, so it is auditable and never touches other people's data).
--
-- Assumes the tables used by the app already exist: persons, tree_members, relationships, family_trees, profiles.

-- ---------------------------------------------------------------- table
create table if not exists public.member_join_requests (
  id            uuid primary key default gen_random_uuid(),
  tree_id       uuid not null references public.family_trees(id) on delete cascade,
  requester_id  uuid not null references public.profiles(id) on delete cascade,
  person_id     uuid references public.persons(id) on delete set null,   -- the profile they say is them (null = new profile)
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
-- one open (pending/approved) request per user: a user belongs to one joined tree at a time
create unique index if not exists member_join_one_active
  on public.member_join_requests (requester_id) where status in ('pending','approved');
create index if not exists member_join_tree_idx on public.member_join_requests (tree_id, status);

alter table public.member_join_requests enable row level security;
-- No direct table access from the browser: everything goes through the SECURITY DEFINER functions below.
drop policy if exists "join own read" on public.member_join_requests;
create policy "join own read" on public.member_join_requests for select using (requester_id = auth.uid());

-- ---------------------------------------------------------------- helpers
-- Caller's access level in a tree: owner | admin | member | pending | none
create or replace function public.tree_access(p_tree uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from family_trees t where t.id = p_tree and t.owner_id = auth.uid()) then 'owner'
    when exists (select 1 from tree_members tm join persons p on p.id = tm.person_id
                 where tm.tree_id = p_tree and p.claimed_by = auth.uid() and tm.role = 'admin') then 'admin'
    when exists (select 1 from tree_members tm join persons p on p.id = tm.person_id
                 where tm.tree_id = p_tree and p.claimed_by = auth.uid()) then 'member'
    when exists (select 1 from member_join_requests r
                 where r.tree_id = p_tree and r.requester_id = auth.uid() and r.status = 'pending') then 'pending'
    else 'none' end;
$$;
revoke all on function public.tree_access(uuid) from public;
grant execute on function public.tree_access(uuid) to authenticated;

create or replace function public._is_tree_admin(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tree_access(p_tree) in ('owner','admin');
$$;
revoke all on function public._is_tree_admin(uuid) from public;
grant execute on function public._is_tree_admin(uuid) to authenticated;

-- Undo everything a requester added to a tree. Soft delete only; never touches profiles someone else created.
create or replace function public._rollback_requester(p_tree uuid, p_user uuid, p_keep_person uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_people int := 0; n_rels int := 0; n_members int := 0; ids uuid[];
begin
  -- profiles this user created (and nobody else claimed) that live in this tree
  select coalesce(array_agg(p.id), '{}') into ids
  from persons p join tree_members tm on tm.person_id = p.id and tm.tree_id = p_tree
  where p.created_by = p_user and (p.claimed_by is null or p.claimed_by = p_user)
    and p.id is distinct from p_keep_person;

  -- every link they created, plus any link that touches a profile being removed
  update relationships r set status = 'removed'
  where r.tree_id = p_tree and coalesce(r.status::text, 'active') <> 'removed'
    and (r.created_by = p_user or r.person_a_id = any(ids) or r.person_b_id = any(ids));
  get diagnostics n_rels = row_count;

  update persons p set details = coalesce(p.details, '{}'::jsonb)
         || jsonb_build_object('deleted', true, 'deleted_at', now(), 'deleted_reason', 'join request rolled back')
  where p.id = any(ids);
  get diagnostics n_people = row_count;

  delete from tree_members tm
  where tm.tree_id = p_tree and (tm.person_id = any(ids) or tm.added_by = p_user);
  get diagnostics n_members = row_count;

  return jsonb_build_object('profiles_removed', n_people, 'links_removed', n_rels, 'members_removed', n_members);
end $$;
revoke all on function public._rollback_requester(uuid, uuid, uuid) from public;
revoke all on function public._rollback_requester(uuid, uuid, uuid) from authenticated;

-- ---------------------------------------------------------------- preview (read-only, limited fields)
-- Returns the tree that contains p_person_id: names + structure + who the admins are. No phone/email/notes.
create or replace function public.join_preview(p_person_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tree uuid; v_name text; res jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select tm.tree_id into v_tree from tree_members tm join family_trees t on t.id = tm.tree_id
  where tm.person_id = p_person_id order by t.created_at limit 1;
  if v_tree is null then raise exception 'This profile is not part of a tree yet'; end if;
  select name into v_name from family_trees where id = v_tree;

  select jsonb_build_object(
    'tree_id', v_tree,
    'tree_name', v_name,
    'focus_person_id', p_person_id,
    'my_access', public.tree_access(v_tree),
    'persons', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'gender', p.gender, 'person_code', p.person_code,
        'avatar_url', p.avatar_url, 'birth_year', extract(year from p.dob)::int))
      from tree_members tm join persons p on p.id = tm.person_id
      where tm.tree_id = v_tree and not coalesce((p.details->>'deleted')::boolean, false)), '[]'::jsonb),
    'relationships', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'person_a_id', r.person_a_id, 'person_b_id', r.person_b_id, 'relationship_type', r.relationship_type))
      from relationships r where r.tree_id = v_tree and coalesce(r.status::text, 'active') <> 'removed'), '[]'::jsonb),
    'admins', coalesce((select jsonb_agg(jsonb_build_object('person_id', p.id, 'name', p.full_name, 'role', tm.role) order by (tm.role = 'owner') desc, p.full_name)
      from tree_members tm join persons p on p.id = tm.person_id
      where tm.tree_id = v_tree and tm.role in ('owner','admin')), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.join_preview(uuid) from public;
grant execute on function public.join_preview(uuid) to authenticated;

-- ---------------------------------------------------------------- request / cancel / state
create or replace function public.request_join_tree(p_tree_id uuid, p_person_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rid uuid; v_person uuid := p_person_id; v_name text; v_owner_person boolean;
begin
  if uid is null then raise exception 'Please sign in'; end if;
  if not exists (select 1 from family_trees where id = p_tree_id) then raise exception 'Tree not found'; end if;
  if public.tree_access(p_tree_id) in ('owner','admin','member') then raise exception 'You are already in this tree'; end if;
  if exists (select 1 from member_join_requests where requester_id = uid and status in ('pending','approved')) then
    raise exception 'You already have a join request';
  end if;

  if v_person is not null then
    -- must be a profile that is in this tree and not yet claimed by someone else
    if not exists (select 1 from tree_members where tree_id = p_tree_id and person_id = v_person) then
      raise exception 'That profile is not in this tree';
    end if;
    if exists (select 1 from persons where id = v_person and claimed_by is not null and claimed_by <> uid) then
      raise exception 'That profile already belongs to someone';
    end if;
  else
    -- joining without an existing profile: make a fresh one (rolled back if the request is rejected)
    select coalesce(nullif(display_name, ''), 'Family Member') into v_name from profiles where id = uid;
    v_person := gen_random_uuid();
    insert into persons (id, person_code, full_name, status, created_by)
      values (v_person, 'P-' || (10000 + floor(random() * 89999))::int, v_name, 'unclaimed', uid);
    insert into tree_members (tree_id, person_id, added_by, role) values (p_tree_id, v_person, uid, 'member');
  end if;

  insert into member_join_requests (tree_id, requester_id, person_id) values (p_tree_id, uid, v_person) returning id into rid;
  return rid;
end $$;
revoke all on function public.request_join_tree(uuid, uuid) from public;
grant execute on function public.request_join_tree(uuid, uuid) to authenticated;

create or replace function public.cancel_join_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r member_join_requests; keep uuid;
begin
  select * into r from member_join_requests where id = p_request_id and requester_id = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'No pending request found'; end if;
  update member_join_requests set status = 'cancelled', decided_at = now() where id = r.id;
  -- if they picked someone else's profile, keep it; if it was a profile they created, it is rolled back
  keep := case when exists (select 1 from persons where id = r.person_id and created_by = auth.uid()) then null else r.person_id end;
  return public._rollback_requester(r.tree_id, r.requester_id, keep);
end $$;
revoke all on function public.cancel_join_request(uuid) from public;
grant execute on function public.cancel_join_request(uuid) to authenticated;

-- My latest request (the app calls this at login)
create or replace function public.my_join_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('request_id', r.id, 'tree_id', r.tree_id, 'person_id', r.person_id, 'status', r.status,
             'tree_name', t.name, 'decided_at', r.decided_at)
    from member_join_requests r join family_trees t on t.id = r.tree_id
    where r.requester_id = auth.uid()
    order by (r.status in ('pending','approved')) desc, r.created_at desc limit 1
  ), 'null'::jsonb);
$$;
revoke all on function public.my_join_state() from public;
grant execute on function public.my_join_state() to authenticated;

-- Join requests waiting for ME (I am owner/admin of the tree). Shows how many profiles each requester already added.
create or replace function public.my_incoming_join_requests() returns table (
  request_id uuid, tree_id uuid, tree_name text, requester_name text, person_name text, added_profiles int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.tree_id, t.name,
         coalesce(nullif(pr.display_name, ''), 'Someone'),
         (select p.full_name from persons p where p.id = r.person_id),
         (select count(*)::int from persons p join tree_members tm on tm.person_id = p.id and tm.tree_id = r.tree_id
            where p.created_by = r.requester_id and p.id is distinct from r.person_id
              and not coalesce((p.details->>'deleted')::boolean, false)),
         r.created_at
  from member_join_requests r
  join family_trees t on t.id = r.tree_id
  left join profiles pr on pr.id = r.requester_id
  where r.status = 'pending' and public._is_tree_admin(r.tree_id)
  order by r.created_at;
$$;
revoke all on function public.my_incoming_join_requests() from public;
grant execute on function public.my_incoming_join_requests() to authenticated;

-- ---------------------------------------------------------------- approve / reject
create or replace function public.approve_join_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r member_join_requests;
begin
  select * into r from member_join_requests where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already handled'; end if;
  if not public._is_tree_admin(r.tree_id) then raise exception 'Only a tree owner or admin can approve'; end if;

  update member_join_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = r.id;
  -- the requester now owns their profile and is a normal member of the tree
  update persons set claimed_by = r.requester_id, status = 'claimed'
    where id = r.person_id and (claimed_by is null or claimed_by = r.requester_id);
  insert into tree_members (tree_id, person_id, added_by, role)
    values (r.tree_id, r.person_id, auth.uid(), 'member')
    on conflict (tree_id, person_id) do nothing;
end $$;
revoke all on function public.approve_join_request(uuid) from public;
grant execute on function public.approve_join_request(uuid) to authenticated;

create or replace function public.reject_join_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r member_join_requests; keep uuid;
begin
  select * into r from member_join_requests where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already handled'; end if;
  if not public._is_tree_admin(r.tree_id) then raise exception 'Only a tree owner or admin can reject'; end if;
  update member_join_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = r.id;
  keep := case when exists (select 1 from persons where id = r.person_id and created_by = r.requester_id) then null else r.person_id end;
  return public._rollback_requester(r.tree_id, r.requester_id, keep);
end $$;
revoke all on function public.reject_join_request(uuid) from public;
grant execute on function public.reject_join_request(uuid) to authenticated;

-- ---------------------------------------------------------------- read the tree I belong to (owner/admin/member/pending)
create or replace function public.get_joined_tree(p_tree_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare acc text := public.tree_access(p_tree_id);
begin
  if acc = 'none' then raise exception 'You are not part of this tree'; end if;
  return jsonb_build_object(
    'access', acc,
    'members', coalesce((select jsonb_agg(jsonb_build_object('person_id', tm.person_id, 'role', tm.role)) from tree_members tm where tm.tree_id = p_tree_id), '[]'::jsonb),
    'persons', coalesce((select jsonb_agg(to_jsonb(p)) from persons p join tree_members tm on tm.person_id = p.id
                         where tm.tree_id = p_tree_id and not coalesce((p.details->>'deleted')::boolean, false)), '[]'::jsonb),
    'relationships', coalesce((select jsonb_agg(to_jsonb(r)) from relationships r
                         where r.tree_id = p_tree_id and coalesce(r.status::text, 'active') <> 'removed'), '[]'::jsonb));
end $$;
revoke all on function public.get_joined_tree(uuid) from public;
grant execute on function public.get_joined_tree(uuid) to authenticated;

-- ---------------------------------------------------------------- save (the only write path for a joined tree)
-- p_people: array of person rows (DB column names). p_rels: array of relationship rows.
--   NEW rows           -> inserted for everyone with access (pending included)       == "bas new add kar sake"
--   EXISTING rows      -> updated only if: caller created it, OR caller is owner/admin/approved member (and it is unclaimed)
--   relationship removal -> only own links while pending; any link for owner/admin/approved member
-- Rows the caller is not allowed to change are skipped and counted; nothing raises, so one bad row can't block the rest.
create or replace function public.join_sync(p_tree_id uuid, p_people jsonb, p_rels jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); acc text := public.tree_access(p_tree_id);
        can_old boolean; o jsonb; pr public.persons; ex public.persons; rr public.relationships; er public.relationships;
        added int := 0; updated int := 0; skipped int := 0;
begin
  if uid is null then raise exception 'Please sign in'; end if;
  if acc = 'none' then raise exception 'You are not part of this tree'; end if;
  can_old := acc in ('owner','admin','member');

  for o in select * from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) loop
    select * into ex from persons where id = (o->>'id')::uuid;
    if not found then
      pr := jsonb_populate_record(null::public.persons, (o - 'claimed_by' - 'created_by') || jsonb_build_object('created_by', uid));
      if pr.status::text = 'claimed' then pr.status := 'unclaimed'; end if;      -- nobody can self-claim via sync
      insert into public.persons select (pr).*;
      insert into tree_members (tree_id, person_id, added_by, role) values (p_tree_id, pr.id, uid, 'member');
      added := added + 1;
    else
      -- must already live in this tree, otherwise a stranger's profile elsewhere could be overwritten
      if not exists (select 1 from tree_members where tree_id = p_tree_id and person_id = ex.id) then skipped := skipped + 1; continue; end if;
      if ex.created_by = uid or ex.claimed_by = uid or (can_old and ex.claimed_by is null) then
        pr := jsonb_populate_record(null::public.persons, o);
        update persons set full_name = pr.full_name, dob = pr.dob, gender = pr.gender, mobile = pr.mobile, email = pr.email,
               avatar_url = pr.avatar_url, nickname = pr.nickname, show_nickname = pr.show_nickname,
               birth_place = pr.birth_place, current_place = pr.current_place, life_status = pr.life_status, details = pr.details
         where id = ex.id
           and (full_name, dob, gender, mobile, email, avatar_url, nickname, show_nickname, birth_place, current_place, life_status, details)
               is distinct from
               (pr.full_name, pr.dob, pr.gender, pr.mobile, pr.email, pr.avatar_url, pr.nickname, pr.show_nickname, pr.birth_place, pr.current_place, pr.life_status, pr.details);
        if found then updated := updated + 1; end if;
      else
        -- only count it as skipped when the client really tried to change something
        pr := jsonb_populate_record(null::public.persons, o);
        if (ex.full_name, ex.dob, ex.gender, ex.mobile, ex.email, ex.details)
           is distinct from (pr.full_name, pr.dob, pr.gender, pr.mobile, pr.email, pr.details) then skipped := skipped + 1; end if;
      end if;
    end if;
  end loop;

  for o in select * from jsonb_array_elements(coalesce(p_rels, '[]'::jsonb)) loop
    rr := jsonb_populate_record(null::public.relationships, o);
    select * into er from relationships where id = rr.id;
    if found then
      if er.tree_id = p_tree_id and rr.status::text = 'removed' and coalesce(er.status::text, 'active') <> 'removed' then
        if er.created_by = uid or can_old then
          update relationships set status = 'removed' where id = er.id; updated := updated + 1;
        else skipped := skipped + 1; end if;
      end if;
    else
      if rr.status::text = 'removed' then continue; end if;
      if not (exists (select 1 from tree_members where tree_id = p_tree_id and person_id = rr.person_a_id)
          and exists (select 1 from tree_members where tree_id = p_tree_id and person_id = rr.person_b_id)) then skipped := skipped + 1; continue; end if;
      if exists (select 1 from relationships x where x.tree_id = p_tree_id and coalesce(x.status::text,'active') <> 'removed'
                 and x.relationship_type = rr.relationship_type
                 and ((x.person_a_id = rr.person_a_id and x.person_b_id = rr.person_b_id)
                   or (rr.relationship_type::text = 'spouse' and x.person_a_id = rr.person_b_id and x.person_b_id = rr.person_a_id))) then continue; end if;
      rr.tree_id := p_tree_id; rr.created_by := uid;
      insert into public.relationships select (rr).*;
      added := added + 1;
    end if;
  end loop;

  return jsonb_build_object('added', added, 'updated', updated, 'skipped', skipped, 'access', acc);
end $$;
revoke all on function public.join_sync(uuid, jsonb, jsonb) from public;
grant execute on function public.join_sync(uuid, jsonb, jsonb) to authenticated;

-- Delete (soft) one profile in a joined tree: own additions always; anything unclaimed only for owner/admin/approved member.
create or replace function public.join_remove_person(p_tree_id uuid, p_person_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); acc text := public.tree_access(p_tree_id); ex public.persons;
begin
  if acc = 'none' then raise exception 'You are not part of this tree'; end if;
  select * into ex from persons where id = p_person_id;
  if not found or not exists (select 1 from tree_members where tree_id = p_tree_id and person_id = p_person_id) then raise exception 'Profile not found in this tree'; end if;
  if ex.claimed_by is not null then raise exception 'A claimed profile can only be removed by its owner'; end if;
  if not (ex.created_by = uid or acc in ('owner','admin','member')) then raise exception 'You are not allowed to delete this profile'; end if;
  update relationships set status = 'removed' where tree_id = p_tree_id and (person_a_id = p_person_id or person_b_id = p_person_id);
  update persons set details = coalesce(details, '{}'::jsonb) || jsonb_build_object('deleted', true, 'deleted_at', now()) where id = p_person_id;
  delete from tree_members where tree_id = p_tree_id and person_id = p_person_id;
end $$;
revoke all on function public.join_remove_person(uuid, uuid) from public;
grant execute on function public.join_remove_person(uuid, uuid) to authenticated;
