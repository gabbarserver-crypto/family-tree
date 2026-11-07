-- Family Chat: one group chat per family tree.
-- Run once in the Supabase SQL editor.

create table if not exists public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  tree_id           uuid not null references public.family_trees(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete cascade,
  sender_name       text,
  body              text not null check (char_length(body) between 1 and 2000),
  created_at        timestamptz not null default now()
);

create index if not exists chat_messages_tree_created_idx
  on public.chat_messages (tree_id, created_at desc);

-- Who may use a tree's chat: the tree owner, or anyone whose claimed profile is a member of that tree.
create or replace function public.can_use_tree_chat(p_tree_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.family_trees t where t.id = p_tree_id and t.owner_id = auth.uid())
      or exists (
        select 1
        from public.tree_members tm
        join public.persons p on p.id = tm.person_id
        where tm.tree_id = p_tree_id and p.claimed_by = auth.uid()
      );
$$;

alter table public.chat_messages enable row level security;

drop policy if exists "chat read"   on public.chat_messages;
drop policy if exists "chat insert" on public.chat_messages;
drop policy if exists "chat delete" on public.chat_messages;

create policy "chat read"   on public.chat_messages for select
  using (public.can_use_tree_chat(tree_id));

create policy "chat insert" on public.chat_messages for insert
  with check (sender_profile_id = auth.uid() and public.can_use_tree_chat(tree_id));

create policy "chat delete" on public.chat_messages for delete
  using (sender_profile_id = auth.uid());

-- Live updates (Realtime)
alter table public.chat_messages replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;
