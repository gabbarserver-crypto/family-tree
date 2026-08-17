-- V10 Admin, Moderation & Safety tables
create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check(role in ('super_admin','admin','moderator')),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(profile_id, role)
);

create table if not exists public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_profile_id uuid references public.profiles(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  status text not null default 'pending'
    check(status in ('pending','reviewing','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  resolution text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.account_actions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null check(action_type in ('warning','suspend','unsuspend','restrict')),
  reason text,
  performed_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_roles_profile on public.admin_roles(profile_id);
create index if not exists idx_reports_status on public.moderation_reports(status, created_at desc);
create index if not exists idx_audit_actor_created on public.audit_logs(actor_profile_id, created_at desc);
create index if not exists idx_account_actions_profile on public.account_actions(profile_id, created_at desc);

-- IMPORTANT:
-- These tables need strict RLS policies.
-- Do not expose audit logs to normal users.
-- Privileged actions should be executed server-side where possible.
