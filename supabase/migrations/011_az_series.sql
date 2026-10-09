-- Unique Names posting: the A–Z series (one single name per letter, A–M in Part 1 and N–Z in Part 2, made together
-- on Today). Paste the whole file into the Supabase SQL editor and run it. Safe to run more than once. Needs
-- 010_cta_card.sql first. A fresh project gets all of this from supabase/schema.sql already. Every new column is
-- nullable and no existing function changes (the worker claims series cards like any other: no restart needed).
-- Until this runs, Today simply has no "A–Z series" option.

-- posts: series 'az' + the series id (the request that made it, shared by both parts) + the part number (1 = A–M, 2 = N–Z).
-- All three are null on an ordinary post.
alter table public.posts add column if not exists series text;
alter table public.posts add column if not exists series_id uuid;
alter table public.posts add column if not exists series_part int;
alter table public.posts drop constraint if exists posts_series_check;
alter table public.posts add constraint posts_series_check check (
  (series is null and series_id is null and series_part is null)
  or (series = 'az' and series_id is not null and series_part between 1 and 2));
create index if not exists posts_series on public.posts (series_id) where series_id is not null;

-- create_series: both parts of an A–Z series in one transaction, so a name is never used twice and a double press
-- makes one series. p = {request_id, post_date, gender, theme_id, subject_age?, title_font?, meaning_font?, mark_font?,
-- parts: [{caption, caption_style?, hashtag_set?, cards: [{position, name_id, name, meaning, shot, prompt, seed}]} x 2]}.
-- Idempotent per request_id (= series_id; part 1 carries it as its request_id, part 2 an id derived from it). Both parts
-- share the theme (one photoshoot), which is marked used once. Part 2 is created a millisecond after part 1, so
-- "newest first" lists show Part 2 above Part 1 and the caption history reads them in order.
-- Returns {status: ok, post_ids: [part 1, part 2]} | {status: conflict, reason: theme|names} | {status: error, reason}.
create or replace function public.create_series(p jsonb) returns jsonb language plpgsql as $$
declare
  v_req uuid := (p->>'request_id')::uuid;
  v_theme_id uuid := (p->>'theme_id')::uuid;
  v_theme public.themes%rowtype;
  v_ids uuid[]; v_locked int; v_part jsonb; v_n int := 0; v_post uuid; v_posts uuid[] := '{}';
begin
  select array_agg(id order by series_part) into v_posts from public.posts where series_id = v_req;
  if v_posts is not null then return jsonb_build_object('status', 'ok', 'post_ids', to_jsonb(v_posts)); end if;
  v_posts := '{}';

  if jsonb_typeof(p->'parts') is distinct from 'array' or jsonb_array_length(p->'parts') <> 2 then
    return jsonb_build_object('status', 'error', 'reason', 'A series has two parts.');
  end if;
  if exists (select 1 from jsonb_array_elements(p->'parts') part
             where jsonb_typeof(part->'cards') is distinct from 'array' or jsonb_array_length(part->'cards') = 0) then
    return jsonb_build_object('status', 'error', 'reason', 'A part of the series has no cards.');
  end if;
  select array_agg((c->>'name_id')::uuid) into v_ids
    from jsonb_array_elements(p->'parts') part, jsonb_array_elements(part->'cards') c;
  if (select count(distinct x) from unnest(v_ids) x) <> array_length(v_ids, 1) then
    return jsonb_build_object('status', 'error', 'reason', 'A name is in the series twice.');
  end if;

  select * into v_theme from public.themes where id = v_theme_id for update;
  -- A twin request that held the theme lock until it committed: its series is visible now, so answer with it.
  select array_agg(id order by series_part) into v_posts from public.posts where series_id = v_req;
  if v_posts is not null then return jsonb_build_object('status', 'ok', 'post_ids', to_jsonb(v_posts)); end if;
  v_posts := '{}';
  if v_theme.id is null or v_theme.status <> 'available' or v_theme.gender <> p->>'gender' then
    return jsonb_build_object('status', 'conflict', 'reason', 'theme');
  end if;

  select count(*) into v_locked from (
    select id from public.names
    where id = any (v_ids) and status = 'available' and gender = p->>'gender' and style = 'single'
    for update
  ) s;
  if v_locked <> array_length(v_ids, 1) then
    return jsonb_build_object('status', 'conflict', 'reason', 'names');
  end if;

  for v_part in select value from jsonb_array_elements(p->'parts') loop
    v_n := v_n + 1;
    insert into public.posts (request_id, post_date, gender, style, theme_id, caption, title_font, meaning_font, mark_font, subject_age,
                              caption_style, hashtag_set, series, series_id, series_part, created_at)
    values (case when v_n = 1 then v_req else md5(v_req::text || '|part' || v_n)::uuid end,
            (p->>'post_date')::date, p->>'gender', 'single', v_theme_id, coalesce(v_part->>'caption', ''),
            nullif(btrim(p->>'title_font'), ''), nullif(btrim(p->>'meaning_font'), ''), nullif(btrim(p->>'mark_font'), ''),
            nullif(btrim(p->>'subject_age'), ''), nullif(btrim(v_part->>'caption_style'), ''), nullif(btrim(v_part->>'hashtag_set'), ''),
            'az', v_req, v_n, now() + (v_n - 1) * interval '1 millisecond')
    returning id into v_post;

    insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
    select v_post, v_theme_id, 'post', (c->>'position')::int, (c->>'name_id')::uuid, c->>'name', c->>'meaning',
           c->>'shot', c->>'prompt', (c->>'seed')::bigint, (c->>'position')::int
    from jsonb_array_elements(v_part->'cards') c;

    update public.names n set status = 'reserved', post_id = v_post, position = (c->>'position')::int
    from jsonb_array_elements(v_part->'cards') c where n.id = (c->>'name_id')::uuid;

    v_posts := v_posts || v_post;
  end loop;

  update public.themes set status = 'used', used_on = (p->>'post_date')::date where id = v_theme_id;

  return jsonb_build_object('status', 'ok', 'post_ids', to_jsonb(v_posts));
exception when unique_violation then
  select array_agg(id order by series_part) into v_posts from public.posts where series_id = v_req;
  if v_posts is null then return jsonb_build_object('status', 'error', 'reason', 'The series could not be saved. Try again.'); end if;
  return jsonb_build_object('status', 'ok', 'post_ids', to_jsonb(v_posts));
end $$;

-- @supabase-only begin
revoke execute on function public.create_series(jsonb) from public, anon;
grant execute on function public.create_series(jsonb) to authenticated, service_role;
-- @supabase-only end
