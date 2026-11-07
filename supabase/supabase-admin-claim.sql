-- ADMIN-BY-CLAIM + ADMIN MANAGEMENT + PROFILE TRANSFER
-- Run once in Supabase -> SQL Editor, AFTER supabase-join-tree.sql.
--
-- Rules implemented
--   1. Claiming a profile makes that user an ADMIN of the tree the profile lives in (they can add + edit).
--      Claiming itself is still optional: unclaimed profiles are simply managed by the admins.
--   2. An admin stays admin until another admin (or the owner) removes them. Removing admin does NOT unclaim the profile.
--   3. Any admin can add another admin (the target must be a claimed profile = a person with an account),
--      and any admin can remove another admin. The tree OWNER can never be removed, so a tree always has an admin.
--   4. A claimed profile can be TRANSFERRED to another account with a single-use, 48h code (hashed in the DB).
--      The new account becomes the claimant (and therefore admin). The old account STAYS in the tree as an admin:
--      it gets a fresh, empty card (same name, no contact details/photo) so it keeps its admin role until
--      another admin removes it.
--   5. Someone with a different email who wants a profile that is already claimed cannot take it over:
--      the existing join flow lets them join with a fresh profile; once an admin approves, they become admin (rule 1).
--   6. Admin changes, claims and transfers are written to tree_admin_log.

-- ---------------------------------------------------------------- audit log
create table if not exists public.tree_admin_log (
  id         uuid primary key default gen_random_uuid(),
  tree_id    uuid not null references public.family_trees(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  person_id  uuid references public.persons(id) on delete set null,
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tree_admin_log_tree_idx on public.tree_admin_log (tree_id, created_at desc);
alter table public.tree_admin_log enable row level security;
drop policy if exists "tree admin log read" on public.tree_admin_log;
create policy "tree admin log read" on public.tree_admin_log for select using (public._is_tree_admin(tree_id));
-- no insert/update/delete policies: only the SECURITY DEFINER functions below write to it

-- ---------------------------------------------------------------- 1) claim => admin
-- Works for every claim path (join approval, profile-claim approval, transfer), because it hangs off persons.claimed_by.
create or replace function public._claim_makes_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.claimed_by is not null and (tg_op = 'INSERT' or old.claimed_by is distinct from new.claimed_by) then
    with up as (
      update tree_members tm set role = 'admin'
      where tm.person_id = new.id and tm.role::text = 'member'
      returning tm.tree_id)
    insert into tree_admin_log (tree_id, actor_id, person_id, action, detail)
      select up.tree_id, auth.uid(), new.id, 'admin_by_claim', jsonb_build_object('user', new.claimed_by) from up;
  elsif tg_op = 'UPDATE' and new.claimed_by is null and old.claimed_by is not null then
    -- profile became unclaimed (e.g. account deleted): an empty card must not keep admin rights
    update tree_members tm set role = 'member' where tm.person_id = new.id and tm.role::text = 'admin';
  end if;
  return null;
end $$;
revoke all on function public._claim_makes_admin() from public;
revoke all on function public._claim_makes_admin() from authenticated;

drop trigger if exists persons_claim_makes_admin on public.persons;
create trigger persons_claim_makes_admin after insert or update of claimed_by on public.persons
for each row execute function public._claim_makes_admin();

-- A claimed profile that is added to a tree as plain 'member' (e.g. approve_join_request inserts after claiming) becomes admin.
create or replace function public._member_insert_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role::text = 'member'
     and exists (select 1 from persons p where p.id = new.person_id and p.claimed_by is not null) then
    new.role := 'admin';
  end if;
  return new;
end $$;
revoke all on function public._member_insert_admin() from public;
revoke all on function public._member_insert_admin() from authenticated;

drop trigger if exists tree_members_claimed_admin on public.tree_members;
create trigger tree_members_claimed_admin before insert on public.tree_members
for each row execute function public._member_insert_admin();

-- OPTIONAL one-time backfill: make every ALREADY claimed member an admin too (follows rule 1 for old data).
-- Uncomment and run only if you want that.
-- update public.tree_members tm set role = 'admin'
--   from public.persons p
--  where p.id = tm.person_id and p.claimed_by is not null and tm.role::text = 'member';

-- ---------------------------------------------------------------- 2/3) add / remove admin
create or replace function public.set_tree_admin(p_tree_id uuid, p_person_id uuid, p_make_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_role text; v_claimant uuid;
begin
  if uid is null then raise exception 'Please sign in'; end if;
  if not public._is_tree_admin(p_tree_id) then raise exception 'Only a tree owner or admin can change admin roles'; end if;

  select tm.role::text, p.claimed_by into v_role, v_claimant
  from tree_members tm join persons p on p.id = tm.person_id
  where tm.tree_id = p_tree_id and tm.person_id = p_person_id;
  if not found then raise exception 'Profile not found in this tree'; end if;
  if v_role = 'owner' then raise exception 'The tree owner''s role cannot be changed'; end if;

  if p_make_admin then
    if v_claimant is null then raise exception 'Only a claimed profile (a person with an account) can be made admin'; end if;
    update tree_members set role = 'admin' where tree_id = p_tree_id and person_id = p_person_id;
  else
    -- the owner can never be removed, so at least one admin always remains
    update tree_members set role = 'member' where tree_id = p_tree_id and person_id = p_person_id;
  end if;

  insert into tree_admin_log (tree_id, actor_id, person_id, action, detail)
  values (p_tree_id, uid, p_person_id, case when p_make_admin then 'admin_added' else 'admin_removed' end,
          jsonb_build_object('target_user', v_claimant, 'self', v_claimant = uid));
end $$;
revoke all on function public.set_tree_admin(uuid, uuid, boolean) from public;
grant execute on function public.set_tree_admin(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 4) profile transfer
create table if not exists public.profile_transfers (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.persons(id) on delete cascade,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  code_hash  text not null unique,                       -- sha256 of the code; the code itself is shown once and never stored
  status     text not null default 'open' check (status in ('open','used','cancelled')),
  expires_at timestamptz not null,
  used_by    uuid references public.profiles(id),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists profile_transfer_one_open on public.profile_transfers (person_id) where status = 'open';
alter table public.profile_transfers enable row level security;   -- no policies: functions only

create or replace function public.create_profile_transfer(p_person_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); raw text; v_exp timestamptz := now() + interval '48 hours';
begin
  if uid is null then raise exception 'Please sign in'; end if;
  if not exists (select 1 from persons where id = p_person_id and claimed_by = uid) then
    raise exception 'You can only transfer your own profile';
  end if;
  if exists (select 1 from tree_members tm join family_trees t on t.id = tm.tree_id
             where tm.person_id = p_person_id and (tm.role::text = 'owner' or t.owner_id = uid)) then
    raise exception 'The tree owner''s profile cannot be transferred';
  end if;

  update profile_transfers set status = 'cancelled' where person_id = p_person_id and status = 'open';
  raw := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into profile_transfers (person_id, from_user, code_hash, expires_at)
  values (p_person_id, uid, encode(sha256(convert_to(raw, 'utf8')), 'hex'), v_exp);

  return jsonb_build_object('code', substr(raw,1,4) || '-' || substr(raw,5,4) || '-' || substr(raw,9,4) || '-' || substr(raw,13,4),
                            'expires_at', v_exp);
end $$;
revoke all on function public.create_profile_transfer(uuid) from public;
grant execute on function public.create_profile_transfer(uuid) to authenticated;

create or replace function public.cancel_profile_transfer(p_person_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profile_transfers set status = 'cancelled'
  where person_id = p_person_id and from_user = auth.uid() and status = 'open';
end $$;
revoke all on function public.cancel_profile_transfer(uuid) from public;
grant execute on function public.cancel_profile_transfer(uuid) to authenticated;

create or replace function public.accept_profile_transfer(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.profile_transfers; v_hash text; v_tree uuid; v_new uuid := gen_random_uuid(); v_name text;
begin
  if uid is null then raise exception 'Please sign in'; end if;
  v_hash := encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'utf8')), 'hex');
  select * into t from profile_transfers where code_hash = v_hash and status = 'open' and expires_at > now() for update;
  if not found then raise exception 'Invalid or expired transfer code'; end if;
  if t.from_user = uid then raise exception 'You cannot accept your own transfer'; end if;
  if not exists (select 1 from persons where id = t.person_id and claimed_by = t.from_user) then
    raise exception 'This profile is no longer claimed by the sender';
  end if;
  if exists (select 1 from tree_members where person_id = t.person_id and role::text = 'owner') then
    raise exception 'The tree owner''s profile cannot be transferred';
  end if;

  select tm.tree_id into v_tree from tree_members tm join family_trees ft on ft.id = tm.tree_id
  where tm.person_id = t.person_id order by ft.created_at limit 1;
  if v_tree is null then raise exception 'This profile is not part of a tree'; end if;

  if exists (select 1 from member_join_requests where requester_id = uid and status in ('pending','approved')) then
    raise exception 'You already belong to a joined tree';
  end if;
  if exists (select 1 from persons p join tree_members tm on tm.person_id = p.id
             where tm.tree_id = v_tree and p.claimed_by = uid) then
    raise exception 'You already have a profile in this tree';
  end if;

  -- sender stays in the tree as admin: give them a fresh empty card (the old card goes to the receiver)
  select full_name into v_name from persons where id = t.person_id;
  insert into persons (id, person_code, full_name, status, claimed_by, created_by)
    values (v_new, 'P-' || (10000 + floor(random() * 89999))::int, coalesce(v_name, 'Family Member'), 'claimed', t.from_user, t.from_user);
  insert into tree_members (tree_id, person_id, added_by, role) values (v_tree, v_new, t.from_user, 'admin');
  update member_join_requests set person_id = v_new
   where requester_id = t.from_user and tree_id = v_tree and status in ('pending','approved');
  if not found then
    insert into member_join_requests (tree_id, requester_id, person_id, status, decided_by, decided_at)
    values (v_tree, t.from_user, v_new, 'approved', t.from_user, now());
  end if;

  -- receiver becomes the claimant; the trigger above makes them admin
  update persons set claimed_by = uid, status = 'claimed' where id = t.person_id;
  insert into member_join_requests (tree_id, requester_id, person_id, status, decided_by, decided_at)
  values (v_tree, uid, t.person_id, 'approved', t.from_user, now());

  update profile_transfers set status = 'used', used_by = uid, used_at = now() where id = t.id;
  insert into tree_admin_log (tree_id, actor_id, person_id, action, detail)
  values (v_tree, uid, t.person_id, 'profile_transferred', jsonb_build_object('from_user', t.from_user, 'to_user', uid));

  return jsonb_build_object('tree_id', v_tree, 'person_id', t.person_id);
end $$;
revoke all on function public.accept_profile_transfer(text) from public;
grant execute on function public.accept_profile_transfer(text) to authenticated;
