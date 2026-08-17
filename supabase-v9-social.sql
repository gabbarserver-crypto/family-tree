-- V9 Supabase additions
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_profile_id uuid not null references public.profiles(id) on delete cascade,
  tree_id uuid references public.family_trees(id) on delete cascade,
  person_id uuid references public.persons(id) on delete cascade,
  invited_mobile text,
  invited_email text,
  token_hash text not null unique,
  status text not null default 'pending'
    check(status in ('pending','accepted','expired','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  profile_a_id uuid not null references public.profiles(id) on delete cascade,
  profile_b_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check(status in ('pending','accepted','rejected','blocked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check(profile_a_id <> profile_b_id)
);

create table if not exists public.tree_join_requests (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.family_trees(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check(status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.shared_links (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid references public.family_trees(id) on delete cascade,
  person_id uuid references public.persons(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_invitations_status
on public.invitations(status, expires_at);

create index if not exists idx_social_connections_a
on public.social_connections(profile_a_id, status);

create index if not exists idx_social_connections_b
on public.social_connections(profile_b_id, status);

create index if not exists idx_tree_join_requests_tree
on public.tree_join_requests(tree_id, status);

-- Production note:
-- Add RLS policies that verify the current authenticated user
-- before reading/writing invitations, connections or join requests.
