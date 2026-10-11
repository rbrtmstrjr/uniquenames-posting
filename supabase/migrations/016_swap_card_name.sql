-- Unique Names posting: "My names" in the card dialog (swap a card's name for one from the Names page).
-- Paste the whole file into the Supabase SQL editor and run it. Safe to run more than once. Needs 014_reel_formats.sql
-- first (015_name_nest.sql is not needed). A fresh project gets all of this from supabase/schema.sql already. One new function, no table changes and
-- nothing the worker reads (no restart). Until this runs, the app swaps with a guarded multi-step fallback instead.

-- swap_card_name: in ONE transaction, a post card takes an available name from the names table:
--   * the card (locked, version-guarded, never while it is being made) gets the name, the meaning, name_id and is
--     queued again: p_mode 'restamp' keeps the photo (Pillow only), 'regenerate' makes a new photo with p_seed;
--   * the new name is reserved for the post at the card's position ('used' straight away on a posted post, which
--     refresh_post never touches; a ready post flips it to 'used' through the card trigger as usual);
--   * the old name goes back to 'available' when it came from the names table and no other card uses it.
-- Answers {status: ok, mode} | {status: stale} (the card changed) | {status: taken} (the name is no longer available or
-- doesn't fit the post) | {status: error, reason}. Calling it again after it succeeded answers ok.
create or replace function public.swap_card_name(p_card uuid, p_name uuid, p_version int, p_meaning text, p_mode text, p_seed bigint)
returns jsonb language plpgsql as $$
declare v_card public.cards%rowtype; v_post public.posts%rowtype; v_name public.names%rowtype;
begin
  if p_mode not in ('restamp', 'regenerate') then
    return jsonb_build_object('status', 'error', 'reason', 'Unknown mode.');
  end if;
  select * into v_card from public.cards where id = p_card for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'Card not found.'); end if;
  if v_card.kind <> 'post' or v_card.post_id is null then
    return jsonb_build_object('status', 'error', 'reason', 'Only the name cards of a post take a name.');
  end if;
  if v_card.name_id = p_name then return jsonb_build_object('status', 'ok', 'mode', p_mode); end if;
  if v_card.version <> p_version or v_card.status = 'generating' then return jsonb_build_object('status', 'stale'); end if;

  select * into v_post from public.posts where id = v_card.post_id for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'Post not found.'); end if;
  select * into v_name from public.names
    where id = p_name and status = 'available' and gender = v_post.gender and style = v_post.style for update;
  if not found then return jsonb_build_object('status', 'taken'); end if;

  if v_card.name_id is not null then
    update public.names set status = 'available', post_id = null, position = null
      where id = v_card.name_id and status in ('reserved', 'used')
        and not exists (select 1 from public.cards where name_id = v_card.name_id and id <> p_card);
  end if;
  update public.names
    set status = case when v_post.status = 'posted' then 'used' else 'reserved' end,
        post_id = v_card.post_id, position = v_card.position,
        meaning = coalesce(nullif(btrim(p_meaning), ''), meaning)
    where id = p_name;

  if p_mode = 'restamp' then
    update public.cards set name = v_name.name, meaning = coalesce(nullif(btrim(p_meaning), ''), v_name.meaning), name_id = p_name,
      status = 'restamp', claimed_at = null, error = null, version = v_card.version + 1, queued_at = now()
      where id = p_card;
  else
    update public.cards set name = v_name.name, meaning = coalesce(nullif(btrim(p_meaning), ''), v_name.meaning), name_id = p_name,
      status = 'queued', claimed_at = null, started_at = null, finished_at = null, error = null, attempts = 0,
      version = v_card.version + 1, seed = p_seed, queued_at = now()
      where id = p_card;
  end if;
  return jsonb_build_object('status', 'ok', 'mode', p_mode);
end $$;

-- @supabase-only begin
revoke execute on function public.swap_card_name(uuid, uuid, int, text, text, bigint) from public, anon;
grant execute on function public.swap_card_name(uuid, uuid, int, text, text, bigint) to authenticated, service_role;
-- @supabase-only end
