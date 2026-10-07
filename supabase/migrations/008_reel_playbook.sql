-- Unique Names posting: Reels playbook v2 (hook card, shot list, punch-ins, time jumps, steadier motion). Paste the
-- whole file into the Supabase SQL editor and run it. Safe to run more than once. Needs 007_reel_themes.sql first.
-- A fresh project gets all of this from supabase/schema.sql already. Every new column is nullable or has a default,
-- so the app and the worker from before 008 keep working; run this, then restart the worker (it then plays the new
-- hook card, punch-ins, time-jump dissolves and 'hold' shots). No function changes.

-- the hook card shown over the first 3.5 s (null = none)
alter table public.reels add column if not exists hook_text text;

-- per line (filled by the script engine): the shot size, who is in the picture, a stressed word of the narration for
-- an instant punch-in, and a time jump before the line (the render dissolves into it)
alter table public.reel_scenes add column if not exists shot_size text;
alter table public.reel_scenes drop constraint if exists reel_scenes_shot_size_check;
alter table public.reel_scenes add constraint reel_scenes_shot_size_check
  check (shot_size in ('wide', 'medium', 'close', 'detail', 'pov', 'broll'));
alter table public.reel_scenes add column if not exists subject text;
alter table public.reel_scenes drop constraint if exists reel_scenes_subject_check;
alter table public.reel_scenes add constraint reel_scenes_subject_check
  check (subject in ('mom', 'baby', 'both', 'object', 'none'));
alter table public.reel_scenes add column if not exists punch text;
alter table public.reel_scenes add column if not exists time_jump boolean not null default false;

-- motion: new scripts use push_in / pull_out / hold; the older moves stay valid for rows written before 008
alter table public.reel_scenes drop constraint if exists reel_scenes_motion_check;
alter table public.reel_scenes add constraint reel_scenes_motion_check
  check (motion in ('push_in', 'pull_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'punch', 'hold'));
