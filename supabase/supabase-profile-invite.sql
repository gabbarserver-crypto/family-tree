-- INVITE LINK FOR AN UNCLAIMED PROFILE  (admin optional)
-- Run once in Supabase -> SQL Editor, AFTER supabase-join-tree.sql and supabase-admin-claim.sql.
--
-- What this adds
--   1. A tree OWNER/ADMIN picks an UNCLAIMED profile and creates an invite link for it.
--      At creation time they choose:  make_admin = true  ("Admin bhi banao")  or  false  ("Sirf member").
--   2. Whoever opens the link and signs in sees a confirm screen, taps Accept, and is linked to exactly that profile.
--        make_admin = true   -> they become a tree ADMIN (same as claiming a profile)
--        make_admin = false  -> they become a normal tree MEMBER (can add/edit profiles, cannot manage admins / approve joins / create invites)
--   3. The link is single-use, expires (default 7 days, max 30), can be revoked, and only a SHA-256 hash of the token is stored.
--      Creating a new link for the same profile cancels the older one.
--   4. Create / accept / revoke are written to tree_admin_log.

-- ---------------------------------------------------------------- table
create table if not exists public.profile_invites (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references public.family_trees(id) on delete cascade,
  person_id   uuid not null references public.persons(id) on delete cascade,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  token_hash  text not null unique,                     -- sha256 of the token; the token itself is shown once and never stored
  make_admin  boolean not null default false,
  status      text not null default 'open' check (status in ('open','used','revoked')),
  expires_at  timestamptz not null,
  used_by     uuid references public.profiles(id),
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists profile_invite_one_open on public.profile_invites (person_id) where status = 'open';
alter table public.profile_invites enable row level security;   -- no policies: SECURITY DEFINER functions only

-- ---------------------------------------------------------------- create
create or replace function public.create_profile_invite(p_person_id uuid, p_make_admin boolean default false, p_days int default 7)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_tree uuid; raw text; v_exp timestamptz; v_days int := least(greatest(coalesce(p_days, 7), 1), 30);
begin
  if uid is null then raise exception 'Please sign in'; end if;

  select tm.tree_id into v_tree from tree_members tm join family_trees ft on ft.id = tm.tree_id
  where tm.person_id = p_person_id order by ft.created_at limit 1;
  if v_tree is null then raise exception 'This profile is not part of a tree'; end if;
  if not public._is_tree_admin(v_tree) then raise exception 'Only a tree owner or admin can create an invite link'; end if;

  if not exists (select 1 from persons where id = p_person_id and claimed_by is null
                 and not coalesce((details->>'deleted')::boolean, false)) then
    raise exception 'Only an unclaimed profile can be invited';
  end if;

  v_exp := now() + make_interval(days => v_days);
  update profile_invites set status = 'revoked' where person_id = p_person_id and status = 'open';

  raw := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');   -- 64 hex chars
  insert into profile_invites (tree_id, person_id, created_by, token_hash, make_admin, expires_at)
  values (v_tree, p_person_id, uid, encode(sha256(convert_to(raw, 'utf8')), 'hex'), coalesce(p_make_admin, false), v_exp);

  insert into tree_admin_log (tree_id, actor_id, person_id, action, detail)
  values (v_tree, uid, p_person_id, 'invite_created', jsonb_build_object('make_admin', coalesce(p_make_admin, false), 'expires_at', v_exp));

  return jsonb_build_object('token', raw, 'expires_at', v_exp, 'make_admin', coalesce(p_make_admin, false));
end $$;
revoke all on function public.create_profile_invite(uuid, boolean, int) from public;
grant execute on function public.create_profile_invite(uuid, boolean, int) to authenticated;

-- ---------------------------------------------------------------- revoke
create or replace function public.revoke_profile_invite(p_person_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_tree uuid;
begin
  select tree_id into v_tree from profile_invites where person_id = p_person_id and status = 'open';
  if v_tree is null then return; end if;
  if not public._is_tree_admin(v_tree) then raise exception 'Only a tree owner or admin can revoke an invite link'; end if;
  update profile_invites set status = 'revoked' where person_id = p_person_id and status = 'open';
  insert into tree_admin_log (tree_id, actor_id, person_id, action, detail)
  values (v_tree, auth.uid(), p_person_id, 'invite_revoked', null);
end $$;
revoke all on function public.revoke_profile_invite(uuid) from public;
grant execute on function public.revoke_profile_invite(uuid) to authenticated;

-- ---------------------------------------------------------------- peek (confirm screen; read-only, limited fields)
create or replace function public.peek_profile_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i public.profile_invites; v_hash text;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  v_hash := encode(sha256(convert_to(coalesce(trim(p_token), ''), 'utf8')), 'hex');
  select * into i from profile_invites where token_hash = v_hash and status = 'open' and expires_at > now();
  if not found then raise exception 'Invalid or expired invite link'; end if;
  if not exists (select 1 from persons where id = i.person_id and claimed_by is null
                 and not coalesce((details->>'deleted')::boolean, false)) then
    raise exception 'This profile is no longer available';
  end if;
  return jsonb_build_object(
    'tree_name',   (select name from family_trees where id = i.tree_id),
    'person_name', (select full_name from persons where id = i.person_id),
    'invited_by',  coalesce((select nullif(display_name, '') from profiles where id = i.created_by), 'A family member'),
    'make_admin',  i.make_admin,
    'expires_at',  i.expires_at);
end $$;
revoke all on function public.peek_profile_invite(text) from public;
grant execute on function public.peek_profile_invite(text) to authenticated;

-- ---------------------------------------------------------------- accept
create or replace function public.accept_profile_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i public.profile_invites; v_hash text;
begin
  if uid is null then raise exception 'Please sign in'; end if;
  v_hash := encode(sha256(convert_to(coalesce(trim(p_token), ''), 'utf8')), 'hex');
  select * into i from profile_invites where token_hash = v_hash and status = 'open' and expires_at > now() for update;
  if not found then raise exception 'Invalid or expired invite link'; end if;

  if not exists (select 1 from persons where id = i.person_id and claimed_by is null
                 and not coalesce((details->>'deleted')::boolean, false)) then
    raise exception 'This profile is no longer available';
  end if;
  if not exists (select 1 from tree_members where tree_id = i.tree_id and person_id = i.person_id) then
    raise exception 'This profile is no longer in the tree';
  end if;
  if exists (select 1 from member_join_requests where requester_id = uid and status in ('pending','approved')) then
    raise exception 'You already belong to a joined tree';
  end if;
  if exists (select 1 from persons p join tree_members tm on tm.person_id = p.id
             where tm.tree_id = i.tree_id and p.claimed_by = uid) then
    raise exception 'You already have a profile in this tree';
  end if;

  -- claim: the trigger in supabase-admin-claim.sql turns the claimant into an admin ...
  update persons set claimed_by = uid, status = 'claimed' where id = i.person_id;
  -- ... which we undo again when the inviter chose "member only" (same transaction; nobody ever sees the transient admin row)
  if not i.make_admin then
    update tree_members set role = 'member' where tree_id = i.tree_id and person_id = i.person_id and role::text = 'admin';
    delete from tree_admin_log
     where tree_id = i.tree_id and person_id = i.person_id and action = 'admin_by_claim' and created_at = now();
  end if;

  -- same shape as an approved join, so the app opens this tree for the new member
  insert into member_join_requests (tree_id, requester_id, person_id, status, decided_by, decided_at)
  values (i.tree_id, uid, i.person_id, 'approved', i.created_by, now());

  update profile_invites set status = 'used', used_by = uid, used_at = now() where id = i.id;
  insert into tree_admin_log (tree_id, actor_id, person_id, action, detail)
  values (i.tree_id, uid, i.person_id, 'invite_accepted',
          jsonb_build_object('invited_by', i.created_by, 'make_admin', i.make_admin));

  return jsonb_build_object('tree_id', i.tree_id, 'person_id', i.person_id, 'admin', i.make_admin);
end $$;
revoke all on function public.accept_profile_invite(text) from public;
grant execute on function public.accept_profile_invite(text) to authenticated;
