-- Unique Names posting: Autopilot (the Autopilot page makes, checks and schedules the next days of posts by itself;
-- spec docs/superpowers/specs/2026-11-20-autopilot-design.md). Paste the whole file into the Supabase SQL editor and run
-- it. Safe to run more than once. Needs 020_one_claim.sql and 021_facebook_posting.sql first. A fresh project gets all of
-- this from supabase/schema.sql already. Restart the PC worker afterwards (worker 2.9.0 reads the autopilot flag).

-- The owner's name themes, one per line, in order ("Title" or "Title (hint for the AI)"). After Z the flow goes
-- through them, then back to A.
alter table public.settings add column if not exists autopilot_name_themes text not null default
  E'Unique and modern\nBiblical\nSoft and cool\nShort and sweet\nClassic and timeless\nNature-inspired\nRoyal and elegant\nStrong and brave\nHeavenly (stars, sky, light)';
alter table public.settings drop constraint if exists settings_autopilot_name_themes_len;
alter table public.settings add constraint settings_autopilot_name_themes_len check (char_length(autopilot_name_themes) <= 2000);

-- A name-theme post's title ("Biblical"), like posts.letter for a post by letter.
alter table public.posts add column if not exists name_theme text;
alter table public.posts drop constraint if exists posts_name_theme_len;
alter table public.posts add constraint posts_name_theme_len check (name_theme is null or char_length(name_theme) between 1 and 60);

-- Why Autopilot skipped a saved name (status 'skip'); the owner can bring it back.
alter table public.names add column if not exists autopilot_note text;
alter table public.names drop constraint if exists names_autopilot_note_len;
alter table public.names add constraint names_autopilot_note_len check (autopilot_note is null or char_length(autopilot_note) <= 200);

-- A card's photo check (Autopilot posts only; null on every other card).
alter table public.cards add column if not exists check_state text;
alter table public.cards add column if not exists check_note text;
alter table public.cards add column if not exists remakes int not null default 0;
alter table public.cards drop constraint if exists cards_check_state_check;
alter table public.cards add constraint cards_check_state_check check (check_state is null or check_state in ('pending', 'passed', 'failed', 'removed'));
alter table public.cards drop constraint if exists cards_check_note_len;
alter table public.cards add constraint cards_check_note_len check (check_note is null or char_length(check_note) <= 300);

-- One run = one press of "Make N days". At most one run is active (running / waiting / paused) at a time.
create table if not exists public.autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' constraint autopilot_runs_status_check
    check (status in ('running', 'waiting', 'paused', 'done', 'stopped')),
  days int not null constraint autopilot_runs_days_check check (days between 1 and 7),
  first_day date not null,
  message text constraint autopilot_runs_message_len check (message is null or char_length(message) <= 500),
  events jsonb not null default '[]'::jsonb,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  tick_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists autopilot_runs_one_active on public.autopilot_runs ((true)) where status in ('running', 'waiting', 'paused');

-- One row per planned post of a run.
create table if not exists public.autopilot_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.autopilot_runs (id) on delete cascade,
  day date not null,
  slot text not null constraint autopilot_items_slot_check check (slot in ('morning', 'afternoon')),
  gender text not null constraint autopilot_items_gender_check check (gender in ('boy', 'girl')),
  scheduled_for timestamptz not null,
  letter text constraint autopilot_items_letter_check check (letter is null or letter ~ '^[A-Z]$'),
  name_theme text constraint autopilot_items_name_theme_len check (name_theme is null or char_length(name_theme) between 1 and 60),
  name_count int not null constraint autopilot_items_name_count_check check (name_count between 1 and 30),
  post_id uuid references public.posts (id) on delete set null,
  state text not null default 'planned' constraint autopilot_items_state_check
    check (state in ('planned', 'naming', 'making', 'checking', 'scheduled', 'held')),
  lookalike_done boolean not null default false,
  attempts int not null default 0,
  note text constraint autopilot_items_note_len check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autopilot_items_label check ((letter is null) <> (name_theme is null)),
  constraint autopilot_items_one_slot unique (run_id, day, slot)
);
create index if not exists autopilot_items_run on public.autopilot_items (run_id, scheduled_for);

do $$ declare t text; begin
  foreach t in array array['autopilot_runs', 'autopilot_items'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- claim_next_job (020) + the autopilot flag: every answer says whether a run is active, and with nothing to hand out
-- an active run still answers {kind: 'none', autopilot: true}, so the worker knows to knock on the website.
create or replace function public.claim_next_job(p_comfy_ok boolean, p_music boolean, p_requeue boolean)
returns jsonb language plpgsql as $$
declare v_job jsonb; v_comfy boolean := coalesce(p_comfy_ok, false);
  v_ap boolean := exists (select 1 from public.autopilot_runs where status in ('running', 'waiting'));
begin
  if coalesce(p_requeue, false) then perform public.requeue_stuck_cards(); end if;
  v_job := public.claim_next_card(not v_comfy);
  if v_job is not null then return jsonb_build_object('kind', 'card', 'job', v_job, 'autopilot', v_ap); end if;

  if coalesce(p_requeue, false) then perform public.requeue_stuck_reels(); end if;
  v_job := public.claim_next_reel_step(not v_comfy, coalesce(p_music, false));
  if v_job is not null then return jsonb_build_object('kind', 'reel_step', 'job', v_job, 'autopilot', v_ap); end if;

  if v_comfy then
    v_job := public.claim_next_voice_sample();
    if v_job is not null then return jsonb_build_object('kind', 'voice_sample', 'job', v_job, 'autopilot', v_ap); end if;
    v_job := public.claim_next_theme_preview();
    if v_job is not null then return jsonb_build_object('kind', 'theme_preview', 'job', v_job, 'autopilot', v_ap); end if;
  end if;
  if v_ap then return jsonb_build_object('kind', 'none', 'autopilot', true); end if;
  return null;
end $$;

-- @supabase-only begin
alter table public.autopilot_runs enable row level security;
alter table public.autopilot_items enable row level security;
drop policy if exists owner_all on public.autopilot_runs;
create policy owner_all on public.autopilot_runs for all to authenticated using (true) with check (true);
drop policy if exists owner_all on public.autopilot_items;
create policy owner_all on public.autopilot_items for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.autopilot_runs, public.autopilot_items to authenticated, service_role;
revoke all on public.autopilot_runs, public.autopilot_items from anon;
revoke execute on function public.claim_next_job(boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.claim_next_job(boolean, boolean, boolean) to service_role;
-- @supabase-only end
