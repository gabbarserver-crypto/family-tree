-- supabase-security-fixes.sql
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Test afterwards with 2 accounts: Add Person, Join a tree, Admin pages, login/logout.

-- 1) Legacy tables had Row Level Security OFF (anyone with the anon key could read/write them).
--    All four are empty and the app never uses them. RLS on + no policy = nobody via the API.
alter table public.invitations        enable row level security;
alter table public.social_connections enable row level security;
alter table public.tree_join_requests enable row level security;
alter table public.shared_links       enable row level security;

-- 2) Internal helper functions that had NO permission check and were callable through the API.
--    The app never calls them directly (they are only used inside other SECURITY DEFINER functions).
revoke execute on function public.merge_trees(uuid, uuid, uuid)          from public, anon, authenticated;
revoke execute on function public._rollback_requester(uuid, uuid, uuid)  from public, anon, authenticated;
revoke execute on function public._linked_trees(uuid)                    from public, anon, authenticated;

-- 3) Lookups that should only work for signed-in users
revoke execute on function public.find_person_by_code(text)   from public, anon;
grant  execute on function public.find_person_by_code(text)   to authenticated;
revoke execute on function public.is_tree_chat_user(uuid, uuid) from public, anon;
grant  execute on function public.is_tree_chat_user(uuid, uuid) to authenticated;

-- 4) tree_members: stop users adding themselves (or any profile) to ANY tree with ANY role.
--    A row may only be added by (a) the owner of that tree or (b) a member of that tree (role 'member' only),
--    and only for a profile the user created or claimed. Joining other people's trees goes through the
--    SECURITY DEFINER RPCs (request_join_tree / join_sync / approve_*), which are not affected.
drop policy if exists "tm_insert" on public.tree_members;
drop policy if exists "Users can insert tree memberships they add" on public.tree_members;
create policy tm_insert on public.tree_members for insert to authenticated
with check (
  added_by = auth.uid()
  and exists (select 1 from public.persons p
              where p.id = person_id and (p.created_by = auth.uid() or p.claimed_by = auth.uid()))
  and (
    exists (select 1 from public.family_trees t where t.id = tree_id and t.owner_id = auth.uid())
    or (public.ft_is_tree_member(tree_id) and role = 'member')
  )
);

-- 5) tree_members: whoever added a row could change its role/tree afterwards. Only the tree owner may update.
--    (tm_update already allows the owner.)
drop policy if exists "Users can update tree memberships they added" on public.tree_members;

-- 6) OPTIONAL, do after testing login: no function in public needs to be callable before login.
-- revoke execute on all functions in schema public from anon;
-- alter default privileges in schema public revoke execute on functions from anon;

-- Later, once you are sure nothing needs them, the 4 legacy tables can be dropped:
-- drop table public.invitations, public.social_connections, public.tree_join_requests, public.shared_links;
