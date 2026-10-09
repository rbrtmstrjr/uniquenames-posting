-- Unique Names posting: value-first reel storylines (docs/superpowers/specs/2026-10-09-reel-storylines-design.md).
-- Paste the whole file into the Supabase SQL editor and run it. Safe to run more than once. Needs 013_letter_posts.sql
-- first. A fresh project gets all of this from supabase/schema.sql already.
-- * reels.format: which of the 5 rotating formats the script was written in; reels.topic_id: the topic-bank idea it
--   came from (lib/reels/topics.ts; null when the owner typed a topic). Both null on older reels.
-- * reel_scenes.on_screen: an optional short label (at most 80 characters) the worker draws while that line is spoken.
-- * settings.reel_labels: the "On-screen step labels" switch (default on).
-- * The default narration speed becomes 1.05x (calmer); a settings row still on the old default 1.12 moves to 1.05,
--   any other speed the owner chose is kept.
-- Every new column is nullable or has a default, so the app and the worker from before 014 keep working; restart the
-- worker afterwards so it draws the labels.

alter table public.reels add column if not exists format text;
alter table public.reels add column if not exists topic_id text;
do $$ begin
  alter table public.reels add constraint reels_format_check
    check (format is null or format in ('named_method', 'say_this', 'lola_science', 'scene_lesson', 'problem_fix'));
exception when duplicate_object then null; end $$;

alter table public.reel_scenes add column if not exists on_screen text;
do $$ begin
  alter table public.reel_scenes add constraint reel_scenes_on_screen_len check (on_screen is null or char_length(on_screen) <= 80);
exception when duplicate_object then null; end $$;

alter table public.settings add column if not exists reel_labels boolean not null default true;
alter table public.settings alter column reel_speed set default 1.05;
update public.settings set reel_speed = 1.05 where reel_speed = 1.12;
