-- Hardening patch. Run once in Supabase -> SQL Editor AFTER supabase-chat.sql.

-- 1) Chat: never trust a client-supplied sender_name. Always take it from the sender's profile.
create or replace function public.chat_set_sender_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select coalesce(nullif(p.display_name, ''), 'Family Member') into new.sender_name
  from public.profiles p where p.id = new.sender_profile_id;
  if new.sender_name is null then new.sender_name := 'Family Member'; end if;
  return new;
end $$;

drop trigger if exists chat_set_sender_name on public.chat_messages;
create trigger chat_set_sender_name before insert on public.chat_messages
for each row execute function public.chat_set_sender_name();

-- 2) Chat: basic rate limit (max 20 messages per user per minute).
create or replace function public.chat_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.chat_messages
      where sender_profile_id = new.sender_profile_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Too many messages, slow down';
  end if;
  return new;
end $$;

drop trigger if exists chat_rate_limit on public.chat_messages;
create trigger chat_rate_limit before insert on public.chat_messages
for each row execute function public.chat_rate_limit();
