-- Wall posts with photos / videos.
-- Run once in the Supabase SQL editor AFTER supabase-person-wall.sql.
-- Files live in a PRIVATE storage bucket ("wall-media"); the app shows them through short-lived signed URLs,
-- and only people who can view that wall can read them.

-- ===== 1. media column on posts (array of {path, type}) =====
alter table public.person_wall_posts add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.person_wall_posts drop constraint if exists person_wall_posts_body_check;
alter table public.person_wall_posts drop constraint if exists person_wall_posts_body_len;
alter table public.person_wall_posts drop constraint if exists person_wall_posts_media_arr;
alter table public.person_wall_posts drop constraint if exists person_wall_posts_not_empty;
alter table public.person_wall_posts alter column body set default '';
alter table public.person_wall_posts add constraint person_wall_posts_body_len  check (char_length(body) <= 2000);
alter table public.person_wall_posts add constraint person_wall_posts_media_arr check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 4);
alter table public.person_wall_posts add constraint person_wall_posts_not_empty check (char_length(body) > 0 or jsonb_array_length(media) > 0);

-- ===== 2. private storage bucket =====
-- 50 MB per file is the free-plan ceiling; the app itself limits videos to 40 MB and shrinks photos before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wall-media', 'wall-media', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A file may be read by its uploader, or by anyone who can view the wall of a post that references it.
-- (SECURITY DEFINER because person_wall_posts is closed to direct access.)
create or replace function public.can_read_wall_media(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_path, '/', 1) = auth.uid()::text
      or exists (
        select 1 from public.person_wall_posts w
        where w.media @> jsonb_build_array(jsonb_build_object('path', p_path))
          and public.can_view_person_wall(w.person_id)
      );
$$;
grant execute on function public.can_read_wall_media(text) to authenticated;

drop policy if exists "wall_media_insert" on storage.objects;
drop policy if exists "wall_media_select" on storage.objects;
drop policy if exists "wall_media_delete" on storage.objects;
create policy "wall_media_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'wall-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "wall_media_select" on storage.objects for select to authenticated
  using (bucket_id = 'wall-media' and public.can_read_wall_media(name));
create policy "wall_media_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'wall-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== 3. functions (return types / signatures change, so drop first) =====
drop function if exists public.add_person_wall_post(uuid, text, uuid[]);
drop function if exists public.list_person_wall(uuid);
drop function if exists public.list_wall_feed(uuid);

create or replace function public.add_person_wall_post(
  p_person_id uuid, p_body text, p_tagged uuid[] default '{}', p_media jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tags uuid[]; v_body text := btrim(coalesce(p_body, '')); v_media jsonb := coalesce(p_media, '[]'::jsonb);
begin
  if auth.uid() is null or not public.can_view_person_wall(p_person_id) then
    raise exception 'No access to this wall';
  end if;
  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 4 then raise exception 'Invalid media (max 4 files)'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_media) e
    where coalesce(e->>'type', '') not in ('image', 'video')
       or coalesce(e->>'path', '') !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$')
  ) then raise exception 'Invalid media'; end if;
  if char_length(v_body) > 2000 then raise exception 'Post must be at most 2000 characters'; end if;
  if char_length(v_body) = 0 and jsonb_array_length(v_media) = 0 then raise exception 'Write something or add a photo/video'; end if;
  select coalesce(array_agg(distinct tm.person_id), '{}') into v_tags
  from public.tree_members tm
  where tm.person_id = any (coalesce(p_tagged, '{}'))
    and tm.tree_id in (select tree_id from public.tree_members where person_id = p_person_id);
  insert into public.person_wall_posts (person_id, author_id, author_name, body, tagged_person_ids, media)
  values (p_person_id, auth.uid(), public._wall_author_name(), v_body, v_tags, v_media)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.list_person_wall(p_person_id uuid)
returns table (
  id uuid, author_id uuid, author_name text, body text, created_at timestamptz,
  tagged jsonb, like_count bigint, liked_by_me boolean, comment_count bigint, can_delete boolean, media jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_view_person_wall(p_person_id) then
    raise exception 'No access to this wall';
  end if;
  return query
  select w.id, w.author_id, w.author_name, w.body, w.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', pp.id, 'name', pp.full_name) order by pp.full_name)
              from public.persons pp where pp.id = any (w.tagged_person_ids)), '[]'::jsonb),
    (select count(*) from public.person_wall_likes l where l.post_id = w.id),
    exists (select 1 from public.person_wall_likes l where l.post_id = w.id and l.user_id = auth.uid()),
    (select count(*) from public.person_wall_comments c where c.post_id = w.id),
    (w.author_id = auth.uid()
      or exists (select 1 from public.persons x where x.id = p_person_id and x.claimed_by = auth.uid())),
    w.media
  from public.person_wall_posts w
  where w.person_id = p_person_id
  order by w.created_at desc
  limit 100;
end $$;

create or replace function public.list_wall_feed(p_tree_id uuid)
returns table (
  id uuid, person_id uuid, person_name text, on_own_wall boolean,
  author_id uuid, author_name text, body text, created_at timestamptz,
  tagged jsonb, like_count bigint, liked_by_me boolean, comment_count bigint, can_delete boolean, media jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_view_tree_wall(p_tree_id) then
    raise exception 'No access to this wall';
  end if;
  return query
  select w.id, w.person_id, wp.full_name,
    coalesce(wp.claimed_by = w.author_id, false),
    w.author_id, w.author_name, w.body, w.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', pp.id, 'name', pp.full_name) order by pp.full_name)
              from public.persons pp where pp.id = any (w.tagged_person_ids)), '[]'::jsonb),
    (select count(*) from public.person_wall_likes l where l.post_id = w.id),
    exists (select 1 from public.person_wall_likes l where l.post_id = w.id and l.user_id = auth.uid()),
    (select count(*) from public.person_wall_comments c where c.post_id = w.id),
    (w.author_id = auth.uid() or wp.claimed_by = auth.uid()),
    w.media
  from public.person_wall_posts w
  join public.persons wp on wp.id = w.person_id
  where exists (select 1 from public.tree_members tm where tm.tree_id = p_tree_id and tm.person_id = w.person_id)
  order by w.created_at desc
  limit 100;
end $$;

grant execute on function public.add_person_wall_post(uuid, text, uuid[], jsonb) to authenticated;
grant execute on function public.list_person_wall(uuid)                           to authenticated;
grant execute on function public.list_wall_feed(uuid)                             to authenticated;
