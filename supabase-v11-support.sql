-- FamilyTree V11 Support System
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  category text not null default 'other'
    check(category in ('login_otp','family_tree','profile_claim','duplicate_merge','reels_media','family_wall','account','other')),
  priority text not null default 'medium'
    check(priority in ('low','medium','high','urgent')),
  subject text not null,
  description text,
  status text not null default 'open'
    check(status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid references public.support_messages(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  original_name text,
  mime_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.support_staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'support'
    check(role in ('support','support_lead')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(profile_id)
);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_requester
on public.support_tickets(requester_profile_id, created_at desc);

create index if not exists idx_support_tickets_assignee
on public.support_tickets(assigned_to, status, updated_at desc);

create index if not exists idx_support_messages_ticket
on public.support_messages(ticket_id, created_at);

create index if not exists idx_support_events_ticket
on public.support_ticket_events(ticket_id, created_at);

-- Recommended private Supabase Storage bucket:
-- support-attachments
--
-- IMPORTANT:
-- Add strict RLS policies before production.
-- A requester should see only their tickets.
-- Support staff should see tickets assigned to them (or allowed by support role).
-- Admins can manage support operations according to role.
