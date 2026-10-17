-- Unique Names posting: the PC worker asks for its next job in ONE request (worker 2.8.0). Paste the whole file into the
-- Supabase SQL editor and run it. Safe to run more than once. Needs 007_reel_themes.sql first (015..019 are not
-- needed). A fresh project gets all of this from supabase/schema.sql already. No table changes.
-- Why: every request to Supabase is a line in the project's logs, and the Free plan allows 1 GB of logs a month. The
-- 2.7 worker asked up to six functions one by one on every 3-second poll (~2 requests a second, ~5 million a month,
-- even with nothing to do). claim_next_job does that whole poll in one call; the 2.8.0 worker also polls less often
-- while idle and heartbeats once a minute.
-- Any order with the worker restart is safe: a 2.8.0 worker on a database without this function keeps the old calls
-- (checked again every 10 minutes), and an older worker never calls it. Restart the worker after running it.

do $$ begin
  if to_regprocedure('public.claim_next_reel_step(boolean, boolean)') is null
     or to_regprocedure('public.claim_next_theme_preview()') is null then
    raise exception '020_one_claim.sql needs 006_reel_voices.sql and 007_reel_themes.sql first';
  end if;
end $$;

-- claim_next_job: the worker's whole poll in one call, in exactly the order the worker used to ask:
--   1. p_requeue (the worker asks once a minute, not every poll): requeue_stuck_cards()
--   2. a card: claim_next_card(p_restamp_only = ComfyUI closed): restamps first, then the oldest queued card
--   3. no card: p_requeue: requeue_stuck_reels(); then a reel step: claim_next_reel_step(p_no_comfy = ComfyUI closed,
--      p_music = the worker makes music beds)
--   4. no reel step and ComfyUI up: a voice sample (claim_next_voice_sample), then a theme preview
--      (claim_next_theme_preview)
-- Answers {kind: 'card' | 'reel_step' | 'voice_sample' | 'theme_preview', job: that function's own answer} or null.
-- It calls the same functions, so each kind's rules (cards first, stuck claims, music, 3 tries) stay in one place.
create or replace function public.claim_next_job(p_comfy_ok boolean, p_music boolean, p_requeue boolean)
returns jsonb language plpgsql as $$
declare v_job jsonb; v_comfy boolean := coalesce(p_comfy_ok, false);
begin
  if coalesce(p_requeue, false) then perform public.requeue_stuck_cards(); end if;
  v_job := public.claim_next_card(not v_comfy);
  if v_job is not null then return jsonb_build_object('kind', 'card', 'job', v_job); end if;

  if coalesce(p_requeue, false) then perform public.requeue_stuck_reels(); end if;
  v_job := public.claim_next_reel_step(not v_comfy, coalesce(p_music, false));
  if v_job is not null then return jsonb_build_object('kind', 'reel_step', 'job', v_job); end if;

  if not v_comfy then return null; end if;
  v_job := public.claim_next_voice_sample();
  if v_job is not null then return jsonb_build_object('kind', 'voice_sample', 'job', v_job); end if;
  v_job := public.claim_next_theme_preview();
  if v_job is not null then return jsonb_build_object('kind', 'theme_preview', 'job', v_job); end if;
  return null;
end $$;

-- @supabase-only begin
-- The worker uses the service-role key; nobody else may claim jobs.
revoke execute on function public.claim_next_job(boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.claim_next_job(boolean, boolean, boolean) to service_role;
-- @supabase-only end
