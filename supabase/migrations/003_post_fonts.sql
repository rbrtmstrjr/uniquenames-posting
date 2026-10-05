-- Unique Names posting: fonts chosen per post (on Today). Paste the whole file into the Supabase SQL editor and run it.
-- Safe to run more than once. Needs 002_v2.sql first. A fresh project gets all of this from supabase/schema.sql already.
-- null = the post has no fonts of its own: the PC uses the fonts in settings (the "last used" fonts).

alter table public.posts add column if not exists title_font text;
alter table public.posts add column if not exists meaning_font text;
alter table public.posts add column if not exists mark_font text;

-- create_post: as before, plus the post's fonts (p->>'title_font' etc.; empty = null).
create or replace function public.create_post(p jsonb) returns jsonb language plpgsql as $$
declare
  v_existing uuid; v_post uuid; v_ids uuid[]; v_locked int; v_theme public.themes%rowtype;
  v_theme_id uuid := (p->>'theme_id')::uuid;
begin
  select id into v_existing from public.posts where request_id = (p->>'request_id')::uuid;
  if found then return jsonb_build_object('status', 'ok', 'post_id', v_existing); end if;

  select array_agg((c->>'name_id')::uuid) into v_ids from jsonb_array_elements(p->'cards') c;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    return jsonb_build_object('status', 'error', 'reason', 'The plan has no cards.');
  end if;

  select * into v_theme from public.themes where id = v_theme_id for update;
  if not found or v_theme.status <> 'available' or v_theme.gender <> p->>'gender' then
    return jsonb_build_object('status', 'conflict', 'reason', 'theme');
  end if;

  select count(*) into v_locked from (
    select id from public.names
    where id = any (v_ids) and status = 'available' and gender = p->>'gender' and style = p->>'style'
    for update
  ) s;
  if v_locked <> array_length(v_ids, 1) then
    return jsonb_build_object('status', 'conflict', 'reason', 'names');
  end if;

  insert into public.posts (request_id, post_date, gender, style, theme_id, caption, title_font, meaning_font, mark_font)
  values ((p->>'request_id')::uuid, (p->>'post_date')::date, p->>'gender', p->>'style', v_theme_id, coalesce(p->>'caption', ''),
          nullif(btrim(p->>'title_font'), ''), nullif(btrim(p->>'meaning_font'), ''), nullif(btrim(p->>'mark_font'), ''))
  returning id into v_post;

  insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
  select v_post, v_theme_id, 'post', (c->>'position')::int, (c->>'name_id')::uuid, c->>'name', c->>'meaning',
         c->>'shot', c->>'prompt', (c->>'seed')::bigint, (c->>'position')::int
  from jsonb_array_elements(p->'cards') c;

  update public.names n set status = 'reserved', post_id = v_post, position = (c->>'position')::int
  from jsonb_array_elements(p->'cards') c where n.id = (c->>'name_id')::uuid;

  update public.themes set status = 'used', used_on = (p->>'post_date')::date where id = v_theme_id;

  return jsonb_build_object('status', 'ok', 'post_id', v_post);
exception when unique_violation then
  select id into v_existing from public.posts where request_id = (p->>'request_id')::uuid;
  return jsonb_build_object('status', 'ok', 'post_id', v_existing);
end $$;

-- claim_next_card: as before, plus 'fonts' = the post's fonts (null for previews / posts without fonts).
create or replace function public.claim_next_card(p_restamp_only boolean default false) returns jsonb language plpgsql as $$
declare v_card public.cards%rowtype; v_job text; v_post public.posts%rowtype;
begin
  select * into v_card from public.cards
  where claimed_at is null and status in ('restamp', 'queued')
    and (not p_restamp_only or status = 'restamp')
  order by (status = 'restamp') desc, queued_at
  limit 1 for update skip locked;
  if not found then return null; end if;

  v_job := case when v_card.status = 'restamp' then 'restamp' else 'generate' end;
  update public.cards set
    claimed_at = now(), started_at = now(), error = null,
    status = case when v_job = 'generate' then 'generating' else 'restamp' end,
    attempts = attempts + case when v_job = 'generate' then 1 else 0 end
  where id = v_card.id
  returning * into v_card;

  select * into v_post from public.posts where id = v_card.post_id;
  return jsonb_build_object(
    'job', v_job, 'card', to_jsonb(v_card), 'post_date', v_post.post_date,
    'gender_label', case v_post.gender when 'boy' then 'Boy' when 'girl' then 'Girl' else null end,
    'style_label', case v_post.style when 'two-word' then 'Two-word' when 'single' then 'Single' else null end,
    'fonts', case when v_post.title_font is null and v_post.meaning_font is null and v_post.mark_font is null then null
      else jsonb_build_object('title_font', v_post.title_font, 'meaning_font', v_post.meaning_font, 'mark_font', v_post.mark_font) end);
end $$;
