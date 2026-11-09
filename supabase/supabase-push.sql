-- =====================================================================================
-- Push notifications (Android app) — run ONCE in the Supabase SQL editor.
-- 1) device_tokens: one row per installed phone.
-- 2) notify_user(): asks the "send-push" Edge Function to deliver a push to a user.
-- 3) Triggers: new direct message, new join request (to tree owner/admins).
-- Before step 2/3 work you must deploy the Edge Function and run the two "select vault.create_secret"
-- lines at the bottom (see ANDROID_APK_SETUP.md).
-- =====================================================================================
create extension if not exists pg_net with schema extensions;

create table if not exists public.device_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  platform   text not null default 'android',
  updated_at timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on public.device_tokens (user_id);
alter table public.device_tokens enable row level security;
drop policy if exists "own tokens" on public.device_tokens;
create policy "own tokens" on public.device_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- a token that moves to another account on the same phone is simply re-assigned by the upsert above

-- ---- send helper (server side only) ------------------------------------------------
create or replace function public.notify_user(p_user uuid, p_title text, p_body text, p_page text default null) returns void
language plpgsql security definer set search_path = public, extensions, vault as $$
declare v_url text; v_key text;
begin
  if p_user is null then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_function_key' limit 1;
  if v_url is null or v_key is null then return; end if;          -- not configured yet: silently do nothing
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', v_key),
    body := jsonb_build_object('user_id', p_user, 'title', p_title, 'body', p_body, 'page', p_page)
  );
exception when others then
  null;   -- a failed push must never break the real action
end $$;
revoke all on function public.notify_user(uuid, text, text, text) from public, anon, authenticated;

-- ---- trigger: new direct message -> push to the recipient ---------------------------
create or replace function public._push_on_dm() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_user(new.recipient_id, coalesce(new.sender_name, 'Naya message'), left(new.body, 120), 'wall');
  return new;
end $$;
drop trigger if exists push_on_dm on public.direct_messages;
create trigger push_on_dm after insert on public.direct_messages for each row execute function public._push_on_dm();

-- ---- trigger: new join request -> push to the tree's owner / admins -----------------
create or replace function public._push_on_join() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_name text;
begin
  if new.status <> 'pending' then return new; end if;
  select coalesce(nullif(display_name, ''), 'Koi') into v_name from profiles where id = new.requester_id;
  for r in
    select distinct pe.claimed_by as uid
    from tree_members tm join persons pe on pe.id = tm.person_id
    where tm.tree_id = new.tree_id and tm.role::text in ('owner','admin') and pe.claimed_by is not null
  loop
    perform public.notify_user(r.uid, 'Naya join request', coalesce(v_name, 'Koi') || ' tree join karna chahta hai', 'sharing');
  end loop;
  return new;
end $$;
drop trigger if exists push_on_join on public.member_join_requests;
create trigger push_on_join after insert on public.member_join_requests for each row execute function public._push_on_join();

-- ---- one-time secrets (replace the two values, then run) ----------------------------
-- select vault.create_secret('https://<PROJECT-REF>.supabase.co/functions/v1/send-push', 'push_function_url');
-- select vault.create_secret('<A-LONG-RANDOM-STRING-YOU-CHOOSE>', 'push_function_key');
