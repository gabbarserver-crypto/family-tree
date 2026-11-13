-- =====================================================================================
-- Automatic backup e-mail: once a day the tree owner + all tree admins get an e-mail with a backup file attached
-- AND the list of changes since the last backup. If nothing changed (no edits, no deletes), NO mail is sent.
-- Run once in the Supabase SQL editor (needs supabase-edit-log.sql and supabase-trash.sql first).
-- Then follow ANDROID/BACKUP steps in BACKUP_MAIL_SETUP.md (Edge Function + Resend key + daily schedule).
-- =====================================================================================
create table if not exists public.tree_backup_state (
  tree_id      uuid primary key,
  last_sent_at timestamptz,
  last_count   int
);
alter table public.tree_backup_state enable row level security;
revoke all on public.tree_backup_state from anon, authenticated;

-- every tree + the e-mail addresses of its owner and admins
create or replace function public.backup_trees()
returns table (tree_id uuid, tree_name text, emails text[], last_sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, coalesce(t.name, 'Family Tree'),
         array(select distinct lower(pr.email) from tree_members tm
               join persons pe on pe.id = tm.person_id
               join profiles pr on pr.id = pe.claimed_by
               where tm.tree_id = t.id and tm.role::text in ('owner', 'admin') and pr.email is not null and pr.email <> ''),
         s.last_sent_at
  from family_trees t left join tree_backup_state s on s.tree_id = t.id;
$$;
revoke all on function public.backup_trees() from public, anon, authenticated;

-- changes since the last backup + the full data to attach
create or replace function public.backup_collect(p_tree uuid, p_since timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_changes jsonb; v_count int; v_deleted jsonb;
begin
  select count(*) into v_count from person_edit_log l join tree_members tm on tm.person_id = l.person_id and tm.tree_id = p_tree
    where p_since is null or l.created_at > p_since;
  select v_count + count(*) into v_count from deleted_persons d where d.tree_id = p_tree and (p_since is null or d.deleted_at > p_since);

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_changes from (
    select l.created_at, l.actor_name, pe.full_name as person, l.action, l.changes
    from person_edit_log l join tree_members tm on tm.person_id = l.person_id and tm.tree_id = p_tree
    join persons pe on pe.id = l.person_id
    where p_since is null or l.created_at > p_since
    order by l.created_at desc limit 200) x;
  select coalesce(jsonb_agg(jsonb_build_object('at', d.deleted_at, 'by', d.deleted_by_name, 'person', d.person ->> 'full_name') order by d.deleted_at desc), '[]'::jsonb)
    into v_deleted from deleted_persons d where d.tree_id = p_tree and (p_since is null or d.deleted_at > p_since);

  return jsonb_build_object(
    'change_count', v_count, 'changes', v_changes, 'deleted', v_deleted,
    'persons', (select coalesce(jsonb_agg(to_jsonb(pe) - 'search_tsv'), '[]'::jsonb) from persons pe join tree_members tm on tm.person_id = pe.id where tm.tree_id = p_tree),
    'tree_members', (select coalesce(jsonb_agg(to_jsonb(tm)), '[]'::jsonb) from tree_members tm where tm.tree_id = p_tree),
    'relationships', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from relationships r where r.tree_id = p_tree));
end $$;
revoke all on function public.backup_collect(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.backup_mark_sent(p_tree uuid, p_count int) returns void
language sql security definer set search_path = public as $$
  insert into tree_backup_state (tree_id, last_sent_at, last_count) values (p_tree, now(), p_count)
  on conflict (tree_id) do update set last_sent_at = now(), last_count = p_count;
$$;
revoke all on function public.backup_mark_sent(uuid, int) from public, anon, authenticated;

-- ---- daily schedule (run these two lines AFTER the Edge Function is deployed; enable the pg_cron extension in Dashboard > Database > Extensions) ----
-- select vault.create_secret('https://<PROJECT-REF>.supabase.co/functions/v1/send-backup', 'backup_function_url');
-- select cron.schedule('familytree-daily-backup', '30 18 * * *',   -- 18:30 UTC = 00:00 IST
--   $$ select net.http_post(
--        url := (select decrypted_secret from vault.decrypted_secrets where name = 'backup_function_url'),
--        headers := jsonb_build_object('Content-Type','application/json','x-push-key',(select decrypted_secret from vault.decrypted_secrets where name = 'push_function_key')),
--        body := '{}'::jsonb) $$);
