-- DIRECT (1-to-1) CHAT  - replaces the old common group chat in the app.
-- Run once in Supabase -> SQL Editor.
--
-- Rules
--   * A message is visible ONLY to its sender and its recipient (RLS). Not even tree admins can read other people's chats.
--   * Both people must belong to the same tree (tree owner, or a member whose profile is claimed).
--   * You can delete your own messages. Nobody can edit a message.
--   * The old table public.chat_messages (group chat) is left untouched; the app just stops using it.

create table if not exists public.direct_messages (
  id           uuid primary key default gen_random_uuid(),
  tree_id      uuid not null references public.family_trees(id) on delete cascade,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_name  text,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists direct_messages_recipient_idx on public.direct_messages (recipient_id, created_at desc);
create index if not exists direct_messages_sender_idx    on public.direct_messages (sender_id, created_at desc);
create index if not exists direct_messages_tree_idx      on public.direct_messages (tree_id, created_at desc);

-- Is p_user the owner of the tree, or a member whose profile is claimed by them?
create or replace function public.is_tree_chat_user(p_tree uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from family_trees t where t.id = p_tree and t.owner_id = p_user)
      or exists (select 1 from tree_members tm join persons p on p.id = tm.person_id
                 where tm.tree_id = p_tree and p.claimed_by = p_user);
$$;
revoke all on function public.is_tree_chat_user(uuid, uuid) from public;
grant execute on function public.is_tree_chat_user(uuid, uuid) to authenticated;

alter table public.direct_messages enable row level security;
drop policy if exists "dm read"   on public.direct_messages;
drop policy if exists "dm insert" on public.direct_messages;
drop policy if exists "dm delete" on public.direct_messages;

create policy "dm read" on public.direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

create policy "dm insert" on public.direct_messages for insert
  with check (sender_id = auth.uid()
              and public.is_tree_chat_user(tree_id, auth.uid())
              and public.is_tree_chat_user(tree_id, recipient_id));

create policy "dm delete" on public.direct_messages for delete
  using (sender_id = auth.uid());
-- no UPDATE policy: read receipts go through mark_dm_read() below, nothing else can be changed

-- Mark everything p_other sent me in this tree as read.
create or replace function public.mark_dm_read(p_tree uuid, p_other uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  update direct_messages set read_at = now()
   where tree_id = p_tree and sender_id = p_other and recipient_id = auth.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_dm_read(uuid, uuid) from public;
grant execute on function public.mark_dm_read(uuid, uuid) to authenticated;

-- How many unread messages do I have in this tree (for the badge)?
create or replace function public.dm_unread_count(p_tree uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from direct_messages
   where tree_id = p_tree and recipient_id = auth.uid() and read_at is null;
$$;
revoke all on function public.dm_unread_count(uuid) from public;
grant execute on function public.dm_unread_count(uuid) to authenticated;

-- Live updates (Realtime)
alter table public.direct_messages replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null; end $$;
