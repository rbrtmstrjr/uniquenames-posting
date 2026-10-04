-- Unique Names posting: database. Paste the whole file into the Supabase SQL editor and run it once.

-- ---------------------------------------------------------------- tables
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  caption_template text not null default 'Here are some beautiful names you can give to your baby {gender}. 🥰',
  hashtags text not null default '#parenting #uniquenames #fypシ #highlights #follower',
  handle text not null default '@unique_names',
  min_images int not null default 9 check (min_images between 1 and 30),
  max_images int not null default 13 check (max_images between 1 and 30),
  width int not null default 1080 check (width between 512 and 2048),
  height int not null default 1080 check (height between 512 and 2048),
  sound_on boolean not null default true,
  updated_at timestamptz not null default now(),
  check (min_images <= max_images)
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.worker_status (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz,
  comfyui_ok boolean not null default false,
  gpu text,
  current_card_id uuid,
  worker_version text,
  message text,
  updated_at timestamptz not null default now()
);
insert into public.worker_status (id) values (1) on conflict do nothing;

create table if not exists public.themes (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  gender text not null check (gender in ('boy', 'girl')),
  backdrop text not null, outfit text not null, props text not null, lighting text not null, palette text not null,
  status text not null default 'available' check (status in ('available', 'used', 'archived')),
  sort_order int not null default 0,
  used_on date,
  preview_card_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  post_date date not null,
  gender text not null check (gender in ('boy', 'girl')),
  style text not null check (style in ('two-word', 'single')),
  theme_id uuid not null references public.themes (id),
  caption text not null default '',
  status text not null default 'generating' check (status in ('generating', 'ready', 'posted')),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.names (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  meaning text not null check (char_length(meaning) between 1 and 80),
  gender text not null check (gender in ('boy', 'girl')),
  style text not null check (style in ('two-word', 'single')),
  status text not null default 'available' check (status in ('available', 'reserved', 'used', 'skip')),
  post_id uuid references public.posts (id) on delete set null,
  position int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists names_lower_name on public.names (lower(name));

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts (id) on delete cascade,
  theme_id uuid not null references public.themes (id) on delete cascade,
  kind text not null default 'post' check (kind in ('post', 'preview')),
  position int not null default 1,
  name_id uuid references public.names (id) on delete set null,
  name text not null, meaning text not null, shot text not null, prompt text not null,
  seed bigint not null,
  status text not null default 'queued' check (status in ('queued', 'generating', 'restamp', 'done', 'failed')),
  error text,
  photo_path text, card_path text,
  version int not null default 1,
  selected boolean not null default true,
  order_index int not null default 0,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz, started_at timestamptz, finished_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'preview' or post_id is not null)
);
create index if not exists cards_queue on public.cards (status, queued_at) where status in ('queued', 'restamp');
create index if not exists cards_post on public.cards (post_id, position);
alter table public.themes drop constraint if exists themes_preview_fk;
alter table public.themes add constraint themes_preview_fk foreign key (preview_card_id) references public.cards (id) on delete set null;

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['settings', 'worker_status', 'themes', 'posts', 'names', 'cards'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- post status follows its cards
create or replace function public.refresh_post(p_post uuid) returns void language plpgsql as $$
declare v_status text; v_open int; v_total int;
begin
  if p_post is null then return; end if;
  select status into v_status from public.posts where id = p_post;
  if not found or v_status = 'posted' then return; end if;
  select count(*) filter (where status <> 'done'), count(*) into v_open, v_total from public.cards where post_id = p_post;
  if v_open = 0 and v_total > 0 then
    update public.posts set status = 'ready' where id = p_post and status <> 'ready';
    update public.names set status = 'used' where post_id = p_post and status = 'reserved';
  else
    update public.posts set status = 'generating' where id = p_post and status <> 'generating';
  end if;
end $$;

create or replace function public.cards_after_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_post(old.post_id);
    return old;
  end if;
  perform public.refresh_post(new.post_id);
  if new.kind = 'preview' and new.status = 'done' then
    update public.themes set preview_card_id = new.id where id = new.theme_id and preview_card_id is distinct from new.id;
  end if;
  return new;
end $$;

drop trigger if exists cards_after_change on public.cards;
create trigger cards_after_change after insert or delete or update of status on public.cards
  for each row execute function public.cards_after_change();

-- ---------------------------------------------------------------- create_post
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

  insert into public.posts (request_id, post_date, gender, style, theme_id, caption)
  values ((p->>'request_id')::uuid, (p->>'post_date')::date, p->>'gender', p->>'style', v_theme_id, coalesce(p->>'caption', ''))
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

-- ---------------------------------------------------------------- add_card
create or replace function public.add_card(p_post uuid, c jsonb) returns jsonb language plpgsql as $$
declare v_post public.posts%rowtype; v_card uuid; v_pos int;
begin
  select * into v_post from public.posts where id = p_post for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'Post not found.'); end if;
  perform 1 from public.names
    where id = (c->>'name_id')::uuid and status = 'available' and gender = v_post.gender and style = v_post.style for update;
  if not found then return jsonb_build_object('status', 'conflict'); end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.cards where post_id = p_post;
  insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
  values (p_post, v_post.theme_id, 'post', v_pos, (c->>'name_id')::uuid, c->>'name', c->>'meaning', c->>'shot', c->>'prompt',
          (c->>'seed')::bigint, v_pos)
  returning id into v_card;
  update public.names set status = 'reserved', post_id = p_post, position = v_pos where id = (c->>'name_id')::uuid;
  if v_post.status = 'posted' then update public.posts set status = 'generating' where id = p_post; end if;
  return jsonb_build_object('status', 'ok', 'card_id', v_card);
end $$;

-- ---------------------------------------------------------------- deletes (return storage paths for the caller to remove)
create or replace function public.delete_card(p_card uuid) returns jsonb language plpgsql as $$
declare v_paths jsonb; v_name uuid;
begin
  select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb), max(name_id::text)::uuid
    into v_paths, v_name
  from public.cards, lateral unnest(array[photo_path, card_path]) x where id = p_card;
  update public.names set status = 'available', post_id = null, position = null where id = v_name and status in ('reserved', 'used');
  delete from public.cards where id = p_card;
  return jsonb_build_object('status', 'ok', 'paths', coalesce(v_paths, '[]'::jsonb));
end $$;

create or replace function public.delete_post(p_post uuid) returns jsonb language plpgsql as $$
declare v_paths jsonb; v_theme uuid;
begin
  select theme_id into v_theme from public.posts where id = p_post;
  if not found then return jsonb_build_object('status', 'ok', 'paths', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb) into v_paths
  from public.cards, lateral unnest(array[photo_path, card_path]) x where post_id = p_post;
  update public.names set status = 'available', post_id = null, position = null where post_id = p_post;
  delete from public.posts where id = p_post;
  update public.themes set status = 'available', used_on = null
    where id = v_theme and not exists (select 1 from public.posts where theme_id = v_theme);
  return jsonb_build_object('status', 'ok', 'paths', v_paths);
end $$;

-- ---------------------------------------------------------------- worker: claim + stuck recovery
create or replace function public.claim_next_card() returns jsonb language plpgsql as $$
declare v_card public.cards%rowtype; v_job text; v_date date; v_gender text;
begin
  select * into v_card from public.cards
  where claimed_at is null and status in ('restamp', 'queued')
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

  select post_date, gender into v_date, v_gender from public.posts where id = v_card.post_id;
  return jsonb_build_object(
    'job', v_job, 'card', to_jsonb(v_card), 'post_date', v_date,
    'gender_label', case v_gender when 'boy' then 'Boy' when 'girl' then 'Girl' else null end);
end $$;

create or replace function public.requeue_stuck_cards() returns int language plpgsql as $$
declare v_n int;
begin
  with stuck as (
    select id, status, attempts from public.cards
    where claimed_at < now() - interval '5 minutes' and status in ('generating', 'restamp')
    for update skip locked
  )
  update public.cards c set
    claimed_at = null, started_at = null,
    status = case when s.status = 'generating' and s.attempts >= 3 then 'failed' when s.status = 'generating' then 'queued' else 'restamp' end,
    error = case when s.status = 'generating' and s.attempts >= 3 then 'Gave up after 3 tries: the PC stopped responding in the middle of this card.' else null end,
    queued_at = now()
  from stuck s where c.id = s.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- @supabase-only begin
-- ---------------------------------------------------------------- security
alter table public.settings enable row level security;
alter table public.worker_status enable row level security;
alter table public.themes enable row level security;
alter table public.posts enable row level security;
alter table public.names enable row level security;
alter table public.cards enable row level security;

do $$ declare t text; begin
  foreach t in array array['settings', 'themes', 'posts', 'names', 'cards'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists owner_read on public.worker_status;
create policy owner_read on public.worker_status for select to authenticated using (true);

revoke execute on function public.claim_next_card() from public, anon, authenticated;
revoke execute on function public.requeue_stuck_cards() from public, anon, authenticated;
grant execute on function public.claim_next_card() to service_role;
grant execute on function public.requeue_stuck_cards() to service_role;
revoke execute on function public.create_post(jsonb) from public, anon;
revoke execute on function public.add_card(uuid, jsonb) from public, anon;
revoke execute on function public.delete_card(uuid) from public, anon;
revoke execute on function public.delete_post(uuid) from public, anon;
revoke execute on function public.refresh_post(uuid) from public, anon;
grant execute on function public.refresh_post(uuid) to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('cards', 'cards', false) on conflict (id) do nothing;
drop policy if exists cards_read on storage.objects;
create policy cards_read on storage.objects for select to authenticated using (bucket_id = 'cards');
drop policy if exists cards_delete on storage.objects;
create policy cards_delete on storage.objects for delete to authenticated using (bucket_id = 'cards');

-- ---------------------------------------------------------------- realtime
alter table public.cards replica identity full;
alter table public.posts replica identity full;
do $$ declare t text; begin
  foreach t in array array['cards', 'posts', 'worker_status', 'themes', 'names'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
-- @supabase-only end
