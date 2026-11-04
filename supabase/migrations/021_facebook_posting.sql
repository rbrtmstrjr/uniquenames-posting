-- Unique Names posting: Post now / Schedule to Facebook (the post page publishes the selected cards as ONE multi-photo
-- post through the official Graph API). Paste the whole file into the Supabase SQL editor and run it. Safe to run more
-- than once. Needs 017_initials_posts.sql first. A fresh project gets all of this from supabase/schema.sql already.
-- Six new nullable columns on posts; nothing the worker reads (no restart). Until this runs, the Post now / Schedule
-- buttons answer with "run 021" and nothing is sent to Facebook.
--
-- fb_state is the one safeguard against posting the same album twice: the app sets it to 'publishing' with ONE
-- conditional update before it talks to Facebook, and only from "no Facebook post yet" (null / 'failed'; 'unsure' only
-- when the owner chose Retry anyway).
--   publishing  sending now (fb_attempt_at = when it started; older than 10 minutes counts as unsure)
--   published   on the Page (fb_post_id, fb_permalink)
--   scheduled   Facebook holds it until fb_scheduled_for
--   failed      Facebook answered with an error before the post existed: safe to try again
--   unsure      no answer while the post was being created: the owner checks the Page before retrying
alter table public.posts add column if not exists fb_post_id text;
alter table public.posts add column if not exists fb_permalink text;
alter table public.posts add column if not exists fb_state text;
alter table public.posts add column if not exists fb_scheduled_for timestamptz;
alter table public.posts add column if not exists fb_attempt_at timestamptz;
alter table public.posts add column if not exists fb_error text;
alter table public.posts drop constraint if exists posts_fb_state_check;
alter table public.posts add constraint posts_fb_state_check
  check (fb_state is null or fb_state in ('publishing', 'published', 'scheduled', 'failed', 'unsure'));
alter table public.posts drop constraint if exists posts_fb_error_len;
alter table public.posts add constraint posts_fb_error_len check (fb_error is null or char_length(fb_error) <= 500);
