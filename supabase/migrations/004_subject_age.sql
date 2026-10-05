-- Unique Names posting: the child's age chosen per post (on Today). Paste the whole file into the Supabase SQL editor and run it.
-- Safe to run more than once. Needs 003_post_fonts.sql first. A fresh project gets all of this from supabase/schema.sql already.
-- 'random' = its own child of a random age on every card; 'newborn' or '1'..'7' = one child at that age.
-- null = a post made before ages existed (one baby, newborn or about 8 months): New picture keeps that baby.

alter table public.posts add column if not exists subject_age text
  check (subject_age in ('random', 'newborn', '1', '2', '3', '4', '5', '6', '7'));

-- create_post: as before (003), plus the post's subject_age (p->>'subject_age'; empty = null).
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

  insert into public.posts (request_id, post_date, gender, style, theme_id, caption, title_font, meaning_font, mark_font, subject_age)
  values ((p->>'request_id')::uuid, (p->>'post_date')::date, p->>'gender', p->>'style', v_theme_id, coalesce(p->>'caption', ''),
          nullif(btrim(p->>'title_font'), ''), nullif(btrim(p->>'meaning_font'), ''), nullif(btrim(p->>'mark_font'), ''),
          nullif(btrim(p->>'subject_age'), ''))
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
