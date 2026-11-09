-- SUPPORT DESK: who can see / write what.  Run once in Supabase -> SQL Editor.
-- Your tables already exist (support_tickets, support_messages, support_staff, support_ticket_events, support_attachments)
-- and RLS is ON, but they had NO policies, so nobody could create or read a ticket.
--
--   user   : sees only their own tickets + messages, can create a ticket and write messages on it
--   staff  : (a row in support_staff with active = true, or any row in admin_roles) sees ALL tickets/messages,
--            replies, assigns and resolves
--   status : moves automatically (see trigger at the bottom) - staff reply => in_progress, user writes on a resolved ticket => open

create or replace function public.is_support_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from support_staff s where s.profile_id = auth.uid() and s.active)
      or exists (select 1 from admin_roles a where a.profile_id = auth.uid());
$$;
revoke all on function public.is_support_staff() from public;
grant execute on function public.is_support_staff() to authenticated;

create or replace function public._owns_ticket(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from support_tickets t where t.id = p_ticket and t.requester_profile_id = auth.uid());
$$;
revoke all on function public._owns_ticket(uuid) from public;
grant execute on function public._owns_ticket(uuid) to authenticated;

-- ---- tickets
drop policy if exists "tickets read"   on public.support_tickets;
drop policy if exists "tickets create" on public.support_tickets;
drop policy if exists "tickets staff update" on public.support_tickets;
create policy "tickets read"   on public.support_tickets for select to authenticated
  using (requester_profile_id = auth.uid() or public.is_support_staff());
create policy "tickets create" on public.support_tickets for insert to authenticated
  with check (requester_profile_id = auth.uid());
create policy "tickets staff update" on public.support_tickets for update to authenticated
  using (public.is_support_staff()) with check (public.is_support_staff());

-- ---- messages
drop policy if exists "messages read"  on public.support_messages;
drop policy if exists "messages write" on public.support_messages;
create policy "messages read"  on public.support_messages for select to authenticated
  using (public._owns_ticket(ticket_id) or public.is_support_staff());
create policy "messages write" on public.support_messages for insert to authenticated
  with check (sender_profile_id = auth.uid() and (public._owns_ticket(ticket_id) or public.is_support_staff()));

-- ---- events (audit trail)
drop policy if exists "events read"  on public.support_ticket_events;
drop policy if exists "events write" on public.support_ticket_events;
create policy "events read"  on public.support_ticket_events for select to authenticated
  using (public._owns_ticket(ticket_id) or public.is_support_staff());
create policy "events write" on public.support_ticket_events for insert to authenticated
  with check (actor_profile_id = auth.uid() and (public._owns_ticket(ticket_id) or public.is_support_staff()));

-- ---- attachments
drop policy if exists "attach read"  on public.support_attachments;
drop policy if exists "attach write" on public.support_attachments;
create policy "attach read"  on public.support_attachments for select to authenticated
  using (public._owns_ticket(ticket_id) or public.is_support_staff());
create policy "attach write" on public.support_attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and (public._owns_ticket(ticket_id) or public.is_support_staff()));

-- ---- staff list: a user may only see their own row (the app uses it to decide "am I staff?")
drop policy if exists "staff self read" on public.support_staff;
create policy "staff self read" on public.support_staff for select to authenticated using (profile_id = auth.uid());
-- Adding / removing staff is done by you in the SQL editor (see the bottom of this file), never from the app.

create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
create index if not exists support_tickets_status_idx  on public.support_tickets (status, created_at desc);

-- ---- automatic status + updated_at when a message is written
create or replace function public._support_after_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare t support_tickets;
begin
  select * into t from support_tickets where id = new.ticket_id;
  if not found then return new; end if;
  update support_tickets set
    status = case
      when new.sender_profile_id = t.requester_profile_id and t.status in ('resolved','closed') then 'open'     -- user came back
      when new.sender_profile_id <> t.requester_profile_id and t.status = 'open' then 'in_progress'            -- staff answered
      else t.status end,
    resolved_at = case when new.sender_profile_id = t.requester_profile_id and t.status in ('resolved','closed') then null else t.resolved_at end,
    updated_at = now()
  where id = t.id;
  return new;
end $$;
drop trigger if exists support_after_message on public.support_messages;
create trigger support_after_message after insert on public.support_messages
  for each row execute function public._support_after_message();

-- ---------------------------------------------------------------- make yourself support staff (edit the email, run separately)
-- insert into public.support_staff (profile_id, role, active)
-- select id, 'agent', true from public.profiles where lower(email) = lower('YOUR-LOGIN-EMAIL');
--
-- If it complains about a CHECK constraint on "role", see the allowed values with:
-- select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.support_staff'::regclass and contype = 'c';
