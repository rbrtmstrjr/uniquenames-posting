# Autopilot: make and schedule the next days of posts by itself (2026-11-20)

## Goal
The owner is busy and sometimes forgets to post. One tap on **Make 7 days** should leave the next week of posts made,
checked and scheduled on the Facebook Page, with no further input: the same name flow the owner follows by hand, every
name checked as a parent would, every photo checked one by one, and nothing scheduled that did not pass.

Owner decisions (2026-11-20):
- Runs on demand, not continuously: the owner presses it (e.g. for 7 days), and again when those days run out.
- Short letters: the AI adds names itself, but every name must pass a parent's-eye quality check ("no trash names").
- Photoshoot themes stay the owner's job; Autopilot only uses the available themes and says when they run out.
- Built inside the app (approach A), not a browser bot or an n8n flow.
- Checks run on Claude Opus 5.5.

## Behaviour

### Starting a run
- New sidebar page **Autopilot** with **Make N days** (N = 1 to 7, default 7). Before it starts, it shows the plan:
  dates, letters / name themes per day, number of posts, and any problem it can already see (e.g. "only 4 girl themes
  left: the run will stop after Tue"). The owner presses **Start**.
- One run at a time. **Stop** ends the run at once: nothing new is made or scheduled; posts already scheduled stay (each
  can be cancelled on its post page as today); posts still being made are left as normal posts on Posts, not scheduled.
  **Resume** continues a run that paused on an error (see Errors).
- The page shows each planned post and its state, live: waiting, picking names, making cards (x/y), checking,
  remaking (why), scheduled (time, link to the post), held (why).
- At the end: a summary (posts scheduled, names the AI added, names skipped, cards remade and why, held posts and what
  they need, real AI cost of the run).

### What it makes
- **Days.** The first day is the day after the last day that already has a Facebook post (scheduled or published),
  and never earlier than tomorrow (Manila). Each day gets exactly two posts: one boy, one girl, never two of the same
  gender.
- **Times.** Each day, one post in the morning window **8:00 to 9:59 AM** and one in the afternoon window
  **1:00 to 1:59 PM** (Manila), at a random minute, picked independently every day. Which gender goes in the morning is
  random each day.
- **Name flow.** One letter or name theme per day; both posts of the day use it.
  - Letters continue from the label of the post with the latest Facebook time (scheduled or published) that has a
    letter or a name theme; manual posts count: ... R, S, T ... Z. Inside a run, each day takes the next label.
  - After Z come the **name themes**, in the owner's order. Starter list (editable on the Autopilot page: add, remove,
    reorder): Unique and modern, Biblical, Soft and cool, Short and sweet, Classic and timeless, Nature-inspired,
    Royal and elegant, Strong and brave, Heavenly (stars, sky, light).
  - After the last name theme, back to A. Names never repeat (used names stay used).
  - If the last label is a name theme no longer in the list, the flow continues at the first name theme.
- **Each post:** single names only, a random **8 to 14 names** (kept inside the Settings min/max) plus the front card and
  the closing card, so 10 to 16 cards (changed 2026-11-21: front card added; see `docs/superpowers/specs/2026-11-21-front-card-design.md`). Photoshoot theme: the planner's usual pick among the available themes of that gender (as Today does when none
  is chosen). Child's age: Random. Fonts and text: Settings. Caption: the usual AI caption.
- **Name-theme posts** carry a label like letter posts do ("Biblical names" on Posts, Today and the post page), a
  caption line that mentions the theme, and a theme hashtag in a theme-tag slot: `#` + the title in lowercase letters
  only + `names` unless it already ends in "names" (Biblical -> `#biblicalnames`,
  Soft and cool -> `#softandcoolnames`).

### Names: the parent's-eye check
- For each post, before any card is made:
  1. Candidates: the available names of that gender (single style) that start with the letter; for a name theme, the
     available names the judge finds to fit the theme.
  2. **Parent check** (Claude Opus 5.5) on every candidate, judged as a Filipino parent choosing a name for their baby.
     A name fails if it is made up or very rare, awkward or hard to say, has a bad, silly or joke meaning, is the wrong
     gender, is too close to another name in the post (sound or spelling), or does not truly fit the letter / theme.
     A meaning that is wrong (not just worded differently) is corrected, with a line in the run's activity (or the
     name fails if it has none). At most 60 saved names are judged per post (a random pick when there are more).
  3. Short of the target: ask the AI for more (the existing By letter suggestions; for a name theme, the existing name
     suggestions with the theme as the wish), then parent-check those. At most 2 extra rounds.
  4. New names that pass are saved to Names (available, then used by the post as usual). Saved names that fail the
     parent check are set to `skip` with the reason ("Skipped by Autopilot: hard to say"); nothing is deleted and the
     owner can restore them. A name the owner restored is never skipped again (it is only left unused when it does not
     pass). If more than 40% of the saved names judged for one post would be skipped, none is skipped that round and
     the run's activity lists them for the owner to look at. A saved name that is fine but does not fit this post
     (another theme, too close to another name in the post) is simply not used.
- A post needs at least **8** good names. Fewer after the extra rounds: the post is **held** ("needs names for S").

### Photos: checked one by one
- Each card, the closing card included, is checked as soon as the PC finishes it: the stamped card image, so the name
  is judged too.
- A card **fails** for: extra, missing or fused fingers or toes, deformed hands or feet; a warped face or eyes; feet
  with the soles to the camera from the floor ("looks dead"); skin beyond bare arms, legs and feet (no bare chest,
  bottom or diaper-only frames); split, collage or picture-in-picture frames; letters or text inside the photo; the
  stamped name covering the baby's face; an extra baby or stray body parts.
  Still-life cards (no baby, by design) are judged on the same rules that apply to them.
- A failed card is **remade**: new seed, same shot (the existing New picture path). Up to **2 remakes** per card.
- When every card of a post has passed, a **look-alike check** sees all the post's cards together and names cards that
  look too alike (same pose, angle and props), at most 3. Each named card is remade once; the remade cards get the
  normal check, not a second look-alike round. If the look-alike check itself cannot run, it is skipped (each card was
  already checked on its own).
- A card that still fails after its remakes is unselected (kept, not uploaded). The post goes out with fewer cards if it
  still has at least 7 passed name cards; otherwise it is **held**. (The front card does not count toward the 7.)
- A check that cannot run (AI error, refusal, timeout) counts as not passed: the card is remade once; if it still cannot
  be checked, the post is **held**. **Nothing is scheduled with an unchecked card.** The exception is the front card: one
  that cannot be checked or keeps failing is left out (unselected) and the post goes out
  (see `docs/superpowers/specs/2026-11-21-front-card-design.md`).
- The post page shows each card's result as a small mark: "Checked", "Remade: extra finger", "Removed: hands".
- An owner edit to an Autopilot card (New picture, Retry, re-stamp, closing-card text) sets its check back to pending,
  and a card the owner selects again after it was removed is checked again: it is checked before the post is
  scheduled. The schedule itself refuses a selected card that has not passed.

### Scheduling
- When a post's cards all passed and the look-alike check is done, the post is scheduled on Facebook at its time, with
  its caption, through the same code (and the same double-post guard) as the Schedule button.
- If the post is ready less than 20 minutes before its time, it is **held** ("too late for Sat 9:12 AM"), never moved
  or squeezed in. The owner can schedule or post it by hand.
- Facebook schedules up to 29 days ahead: the plan preview warns when a run reaches past that.

### Held posts
A held post is a normal post on Posts (status ready, not on Facebook), listed under "Needs you" on the Autopilot page
with its reason. The run continues with the next post.

## How it works

### Who does what
- **Website (Vercel):** all decisions. A server route `POST /api/autopilot/tick` does the next bounded step(s) of the
  active run and returns. All AI calls, Facebook calls and database writes happen there. It reuses createPost (with
  chosen names), the letter and name suggestions, New picture, the AI caption and the Facebook schedule core.
- **PC worker:** makes the cards as today, and is the run's clock. While a run is active, a small background thread
  calls the tick route about every 30 seconds (also while a card is being made). It learns that a run is active from its
  normal poll (`claim_next_job` answers with an `autopilot` flag), so on days without a run nothing changes.
- **One post at a time:** a new post is created only when no Autopilot post is still picking names and at most one is
  making cards, so remakes are not stuck behind a long queue.

### A tick
One tick, under a lock (one conditional update on the run row: `tick_until` set to now + 4 minutes only if it is in the
past; no row = another tick is working, return at once):
1. If the run is not `running` or `waiting`, return.
2. If the PC is offline or ComfyUI is closed, mark the run "waiting for the PC" and return (no posts are created; checks
   of already-finished cards still run).
3. Check every newly finished card of the run's posts (up to 6 in parallel); queue remakes; unselect cards out of
   remakes.
4. For each post whose cards all passed: run the look-alike check once; then schedule it (or hold it).
5. If the pipeline has room, plan the next post: pick and check names, create the post (cards are queued for the PC).
6. If every planned post is scheduled or held, finish the run and write the summary.
Every step is safe to repeat: a tick that dies halfway is finished by the next one.

### Data (migration 022, safe to run twice)
- `settings.autopilot_name_themes` text: one name theme per line, in order (starter list as the default).
- `posts.name_theme` text: the label of a name-theme post (null otherwise), like `posts.letter`.
- `autopilot_runs`: id, status (`running` / `waiting` / `paused` / `done` / `stopped`), days, first_day,
  created_at, finished_at, tick_until, message (why it waits or paused), events jsonb (the run's activity: names added
  or skipped, cards remade or removed, posts scheduled or held; the summary is built from it), input/output tokens.
- `autopilot_items`: one row per planned post: run_id, day, slot (`morning` / `afternoon`), gender, scheduled_for
  (the random time), letter or name_theme, name_count, post_id (once created), state (`planned` / `naming` /
  `making` / `checking` / `scheduled` / `held`), lookalike_done, attempts (name-picking tries), note.
- `cards`: check_state (`pending` / `passed` / `failed` / `removed`), check_note, remakes (count).
- `claim_next_job` also returns `autopilot: true` while a run is `running` or `waiting`.
- RLS: the owner reads and writes as for other tables; the tick route uses the service role.

### Keys
- Vercel (Sensitive): `AUTOPILOT_SECRET` (the worker sends it in a header; the tick route rejects anything else),
  `SUPABASE_SERVICE_ROLE_KEY` (used only by the tick route, server-only), `ANTHROPIC_API_KEY` (already documented).
- `worker/worker.env`: `AUTOPILOT_SECRET` and the site URL (`AUTOPILOT_URL`).

### AI
- Name checks and photo checks: Claude Opus 5.5 with structured output (a fixed JSON shape, checked again in code),
  adaptive thinking at the model's default effort, the built-in refusal fallback on. Photos are sent as signed URLs of
  the stamped card. Every call's tokens are added to the run, so the summary shows the real cost.
- Estimate: about 230 photo checks per 7-day run (about 190 cards plus remakes) and about 30 name calls: roughly $5 a
  run on Opus 5.5. Measured on the first runs.
- Name suggestions keep the app's current AI setting (Gemini or Claude), so a different, stronger model judges them.

### Errors
- PC offline or ComfyUI closed: the run waits and continues when they are back.
- Claude credits empty, Claude key wrong, Facebook token or permissions wrong: the run is `paused`: it stops making,
  checking and scheduling, shows the plain-words reason on the Autopilot page, and continues from where it was once the
  owner fixes it and presses **Resume**.
- Facebook error on one post: that post is held with Facebook's message (the double-post guard applies as today).
- No theme left for a gender: posts of that gender are held ("add girl themes"); the other gender continues.

## Not included (later if wanted)
A Check button for posts made by hand; a manual name-theme option on Today; AI-made photoshoot themes; reels;
two-word names.

## Testing
- Planner (pure, seeded random): first day, one boy + one girl per day, random order, minutes inside the windows and
  varied, letters then name themes then A again, resuming from manual posts, edited theme lists.
- Name step: candidates, parent-check results applied (skip with reason, corrected meanings), extra rounds, hold below 8.
- Photo step: pass, fail -> remake, 2 remakes -> removed, could-not-check -> remake -> held, look-alike once.
- Tick: lock, waits for the PC, pipeline room, schedules through the Facebook core, too-late hold, finish + summary,
  repeat-safety (two ticks, a tick that stopped halfway). Fake Claude, fake Facebook, fake Supabase.
- Migration 022 on PGlite (live database and fresh schema), `claim_next_job` flag.
- Worker: pings only while the flag is on, sends the secret, survives a failed ping.
- Autopilot page: plan preview, Start / Stop / Resume, live states, held list, name-theme editor.
- Before trusting it with a week: a real 1-day run on the owner's PC.
