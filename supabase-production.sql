-- FamilyTree V11 production hardening for the existing schema.
-- Run after: supabase-schema.sql, v8, v9, v10, v11.
-- This migration enables RLS, creates auth profile bootstrap, and adds safe policies.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_roles ar
    where ar.profile_id = auth.uid()
  );
$$;

create or replace function public.is_support()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.support_staff ss
    where ss.profile_id = auth.uid() and ss.active = true
  );
$$;

create or replace function public.is_tree_member(p_tree_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tree_members tm
    where tm.tree_id = p_tree_id and tm.person_id in (
      select p.id from public.persons p where p.claimed_by = auth.uid()
    )
  ) or exists (
    select 1 from public.family_trees ft where ft.id = p_tree_id and ft.owner_id = auth.uid()
  ) or public.is_admin();
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email, new.phone, 'Family Member'), '@', 1)),
    new.email,
    new.phone
  )
  on conflict (id) do update set
    email = excluded.email,
    phone = excluded.phone,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.persons enable row level security;
alter table public.family_trees enable row level security;
alter table public.tree_members enable row level security;
alter table public.relationships enable row level security;
alter table public.connection_requests enable row level security;
alter table public.claim_requests enable row level security;
alter table public.duplicate_candidates enable row level security;
alter table public.merge_requests enable row level security;
alter table public.merge_audit enable row level security;
alter table public.posts enable row level security;
alter table public.events enable row level security;
alter table public.notifications enable row level security;
alter table public.reels enable row level security;
alter table public.reel_reactions enable row level security;
alter table public.reel_comments enable row level security;
alter table public.reel_reports enable row level security;
alter table public.invitations enable row level security;
alter table public.social_connections enable row level security;
alter table public.tree_join_requests enable row level security;
alter table public.shared_links enable row level security;
alter table public.admin_roles enable row level security;
alter table public.moderation_reports enable row level security;
alter table public.audit_logs enable row level security;
alter table public.account_actions enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_attachments enable row level security;
alter table public.support_staff enable row level security;
alter table public.support_ticket_events enable row level security;

-- Drop old policies from previous runs, if any.
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname='public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin() or exists (select 1 from public.social_connections sc where sc.status='accepted' and ((sc.profile_a_id=auth.uid() and sc.profile_b_id=id) or (sc.profile_b_id=auth.uid() and sc.profile_a_id=id))));
create policy profiles_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy profiles_insert on public.profiles for insert to authenticated with check (id=auth.uid());

create policy trees_select on public.family_trees for select to authenticated using (owner_id=auth.uid() or public.is_tree_member(id));
create policy trees_insert on public.family_trees for insert to authenticated with check (owner_id=auth.uid());
create policy trees_update on public.family_trees for update to authenticated using (owner_id=auth.uid() or public.is_admin()) with check (owner_id=auth.uid() or public.is_admin());
create policy trees_delete on public.family_trees for delete to authenticated using (owner_id=auth.uid() or public.is_admin());

create policy persons_select on public.persons for select to authenticated using (claimed_by=auth.uid() or public.is_admin() or exists (select 1 from public.tree_members tm join public.family_trees ft on ft.id=tm.tree_id where tm.person_id=persons.id and (ft.owner_id=auth.uid() or public.is_tree_member(ft.id))));
create policy persons_insert on public.persons for insert to authenticated with check (created_by=auth.uid() or public.is_admin());
create policy persons_update on public.persons for update to authenticated using (created_by=auth.uid() or claimed_by=auth.uid() or public.is_admin() or exists (select 1 from public.tree_members tm where tm.person_id=persons.id and public.is_tree_member(tm.tree_id))) with check (created_by=auth.uid() or claimed_by=auth.uid() or public.is_admin() or exists (select 1 from public.tree_members tm where tm.person_id=persons.id and public.is_tree_member(tm.tree_id)));
create policy persons_delete on public.persons for delete to authenticated using (created_by=auth.uid() or public.is_admin());

create policy tree_members_select on public.tree_members for select to authenticated using (public.is_tree_member(tree_id));
create policy tree_members_insert on public.tree_members for insert to authenticated with check (exists (select 1 from public.family_trees ft where ft.id=tree_id and ft.owner_id=auth.uid()) or public.is_admin());
create policy tree_members_delete on public.tree_members for delete to authenticated using (exists (select 1 from public.family_trees ft where ft.id=tree_id and ft.owner_id=auth.uid()) or public.is_admin());

create policy relationships_select on public.relationships for select to authenticated using (public.is_tree_member(tree_id));
create policy relationships_insert on public.relationships for insert to authenticated with check (public.is_tree_member(tree_id) and (created_by=auth.uid() or public.is_admin()));
create policy relationships_update on public.relationships for update to authenticated using (public.is_tree_member(tree_id)) with check (public.is_tree_member(tree_id));
create policy relationships_delete on public.relationships for delete to authenticated using (public.is_tree_member(tree_id));

create policy posts_select on public.posts for select to authenticated using (tree_id is null or public.is_tree_member(tree_id) or author_profile_id=auth.uid() or visibility='public');
create policy posts_insert on public.posts for insert to authenticated with check (author_profile_id=auth.uid() and (tree_id is null or public.is_tree_member(tree_id)));
create policy posts_update on public.posts for update to authenticated using (author_profile_id=auth.uid() or public.is_admin()) with check (author_profile_id=auth.uid() or public.is_admin());
create policy posts_delete on public.posts for delete to authenticated using (author_profile_id=auth.uid() or public.is_admin());

create policy events_select on public.events for select to authenticated using (tree_id is null or public.is_tree_member(tree_id));
create policy events_insert on public.events for insert to authenticated with check (created_by=auth.uid() and (tree_id is null or public.is_tree_member(tree_id)));
create policy events_update on public.events for update to authenticated using (created_by=auth.uid() or public.is_admin()) with check (created_by=auth.uid() or public.is_admin());
create policy events_delete on public.events for delete to authenticated using (created_by=auth.uid() or public.is_admin());

create policy connection_requests_select on public.connection_requests for select to authenticated using (requested_by=auth.uid() or public.is_admin() or exists (select 1 from public.persons p where p.id=person_id and p.claimed_by=auth.uid()));
create policy connection_requests_insert on public.connection_requests for insert to authenticated with check (requested_by=auth.uid());
create policy connection_requests_update on public.connection_requests for update to authenticated using (requested_by=auth.uid() or exists (select 1 from public.persons p where p.id=person_id and p.claimed_by=auth.uid()) or public.is_admin()) with check (requested_by=auth.uid() or exists (select 1 from public.persons p where p.id=person_id and p.claimed_by=auth.uid()) or public.is_admin());

create policy claim_requests_select on public.claim_requests for select to authenticated using (requested_by=auth.uid() or exists (select 1 from public.persons p where p.id=person_id and p.claimed_by=auth.uid()) or public.is_admin());
create policy claim_requests_insert on public.claim_requests for insert to authenticated with check (requested_by=auth.uid());
create policy claim_requests_update on public.claim_requests for update to authenticated using (requested_by=auth.uid() or public.is_admin()) with check (requested_by=auth.uid() or public.is_admin());

create policy merge_requests_select on public.merge_requests for select to authenticated using (requested_by=auth.uid() or public.is_admin());
create policy merge_requests_insert on public.merge_requests for insert to authenticated with check (requested_by=auth.uid());
create policy merge_requests_update on public.merge_requests for update to authenticated using (requested_by=auth.uid() or public.is_admin()) with check (requested_by=auth.uid() or public.is_admin());

create policy notifications_select on public.notifications for select to authenticated using (recipient_profile_id=auth.uid() or public.is_admin());
create policy notifications_update on public.notifications for update to authenticated using (recipient_profile_id=auth.uid() or public.is_admin()) with check (recipient_profile_id=auth.uid() or public.is_admin());

create policy reels_select on public.reels for select to authenticated using (visibility='public' or author_profile_id=auth.uid() or tree_id is null or public.is_tree_member(tree_id));
create policy reels_insert on public.reels for insert to authenticated with check (author_profile_id=auth.uid());
create policy reels_update on public.reels for update to authenticated using (author_profile_id=auth.uid() or public.is_admin()) with check (author_profile_id=auth.uid() or public.is_admin());
create policy reel_reactions_select on public.reel_reactions for select to authenticated using (true);
create policy reel_reactions_insert on public.reel_reactions for insert to authenticated with check (profile_id=auth.uid());
create policy reel_reactions_delete on public.reel_reactions for delete to authenticated using (profile_id=auth.uid());
create policy reel_comments_select on public.reel_comments for select to authenticated using (exists (select 1 from public.reels r where r.id=reel_id and (r.visibility='public' or r.author_profile_id=auth.uid() or r.tree_id is null or public.is_tree_member(r.tree_id))));
create policy reel_comments_insert on public.reel_comments for insert to authenticated with check (profile_id=auth.uid());
create policy reel_comments_update on public.reel_comments for update to authenticated using (profile_id=auth.uid() or public.is_admin()) with check (profile_id=auth.uid() or public.is_admin());

create policy social_connections_select on public.social_connections for select to authenticated using (profile_a_id=auth.uid() or profile_b_id=auth.uid() or public.is_admin());
create policy social_connections_insert on public.social_connections for insert to authenticated with check (profile_a_id=auth.uid());
create policy social_connections_update on public.social_connections for update to authenticated using (profile_a_id=auth.uid() or profile_b_id=auth.uid() or public.is_admin()) with check (profile_a_id=auth.uid() or profile_b_id=auth.uid() or public.is_admin());

create policy tree_join_requests_select on public.tree_join_requests for select to authenticated using (requested_by=auth.uid() or exists (select 1 from public.family_trees ft where ft.id=tree_id and ft.owner_id=auth.uid()) or public.is_admin());
create policy tree_join_requests_insert on public.tree_join_requests for insert to authenticated with check (requested_by=auth.uid());
create policy tree_join_requests_update on public.tree_join_requests for update to authenticated using (requested_by=auth.uid() or public.is_admin()) with check (requested_by=auth.uid() or public.is_admin());

create policy invitations_select on public.invitations for select to authenticated using (inviter_profile_id=auth.uid() or public.is_admin());
create policy invitations_insert on public.invitations for insert to authenticated with check (inviter_profile_id=auth.uid());
create policy shared_links_select on public.shared_links for select to authenticated using (created_by=auth.uid() or public.is_admin());
create policy shared_links_insert on public.shared_links for insert to authenticated with check (created_by=auth.uid());
create policy shared_links_update on public.shared_links for update to authenticated using (created_by=auth.uid() or public.is_admin()) with check (created_by=auth.uid() or public.is_admin());

create policy admin_roles_select on public.admin_roles for select to authenticated using (profile_id=auth.uid() or public.is_admin());
create policy moderation_reports_select on public.moderation_reports for select to authenticated using (reporter_profile_id=auth.uid() or public.is_admin() or public.is_support());
create policy moderation_reports_insert on public.moderation_reports for insert to authenticated with check (reporter_profile_id=auth.uid());
create policy moderation_reports_update on public.moderation_reports for update to authenticated using (public.is_admin() or public.is_support()) with check (public.is_admin() or public.is_support());
create policy audit_logs_select on public.audit_logs for select to authenticated using (public.is_admin());
create policy account_actions_select on public.account_actions for select to authenticated using (profile_id=auth.uid() or public.is_admin());
create policy account_actions_insert on public.account_actions for insert to authenticated with check (public.is_admin() or public.is_support());
create policy support_staff_select on public.support_staff for select to authenticated using (profile_id=auth.uid() or public.is_admin());

create policy support_tickets_select on public.support_tickets for select to authenticated using (requester_profile_id=auth.uid() or assigned_to=auth.uid() or public.is_support() or public.is_admin());
create policy support_tickets_insert on public.support_tickets for insert to authenticated with check (requester_profile_id=auth.uid());
create policy support_tickets_update on public.support_tickets for update to authenticated using (requester_profile_id=auth.uid() or assigned_to=auth.uid() or public.is_support() or public.is_admin()) with check (requester_profile_id=auth.uid() or assigned_to=auth.uid() or public.is_support() or public.is_admin());
create policy support_messages_select on public.support_messages for select to authenticated using (exists (select 1 from public.support_tickets st where st.id=ticket_id and (st.requester_profile_id=auth.uid() or st.assigned_to=auth.uid() or public.is_support() or public.is_admin())));
create policy support_messages_insert on public.support_messages for insert to authenticated with check (sender_profile_id=auth.uid() and exists (select 1 from public.support_tickets st where st.id=ticket_id and (st.requester_profile_id=auth.uid() or st.assigned_to=auth.uid() or public.is_support() or public.is_admin())));
create policy support_attachments_select on public.support_attachments for select to authenticated using (uploaded_by=auth.uid() or public.is_support() or public.is_admin() or exists (select 1 from public.support_tickets st where st.id=ticket_id and st.requester_profile_id=auth.uid()));
create policy support_attachments_insert on public.support_attachments for insert to authenticated with check (uploaded_by=auth.uid());
create policy support_ticket_events_select on public.support_ticket_events for select to authenticated using (public.is_support() or public.is_admin() or exists (select 1 from public.support_tickets st where st.id=ticket_id and st.requester_profile_id=auth.uid()));
create policy support_ticket_events_insert on public.support_ticket_events for insert to authenticated with check (actor_profile_id=auth.uid());

-- Storage buckets. Keep them private. Create policies separately in storage.objects.
insert into storage.buckets (id, name, public) values
  ('family-reels','family-reels',false),
  ('family-reel-thumbnails','family-reel-thumbnails',false),
  ('support-attachments','support-attachments',false)
on conflict (id) do update set public=false;

drop policy if exists storage_user_read on storage.objects;
drop policy if exists storage_user_insert on storage.objects;
drop policy if exists storage_user_update on storage.objects;
drop policy if exists storage_user_delete on storage.objects;

-- Basic private-storage policy: users can manage only objects under their own UUID prefix.
create policy storage_user_read on storage.objects for select to authenticated using (bucket_id in ('family-reels','family-reel-thumbnails','support-attachments') and (owner_id::text = auth.uid()::text or public.is_admin() or public.is_support()));
create policy storage_user_insert on storage.objects for insert to authenticated with check (bucket_id in ('family-reels','family-reel-thumbnails','support-attachments') and (name like auth.uid()::text || '/%' ));
create policy storage_user_update on storage.objects for update to authenticated using (bucket_id in ('family-reels','family-reel-thumbnails','support-attachments') and (owner_id::text = auth.uid()::text or public.is_admin() or public.is_support()));
create policy storage_user_delete on storage.objects for delete to authenticated using (bucket_id in ('family-reels','family-reel-thumbnails','support-attachments') and (owner_id::text = auth.uid()::text or public.is_admin() or public.is_support()));
