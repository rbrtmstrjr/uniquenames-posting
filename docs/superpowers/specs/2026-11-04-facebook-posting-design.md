# Post now / Schedule to Facebook (2026-11-04)

## Goal
Publish a finished post straight to the Facebook Page from the post page, instead of saving the cards to the phone and
uploading them by hand. Posting only: no comments, likes or any other activity. Research (reports/Facebook auto
posting monetization risk.md): the official Graph API is an authorized route; the real risks are content (owner's
captions are already minimal) and duplicate posts, so the one safeguard is "never post the same album twice".

## Behaviour
- Post page > "Save for Facebook" panel gains **Post now** (with a confirm step) and **Schedule** (date + time in Manila,
  10 minutes to 30 days ahead). Save to phone / zip stay as the fallback.
- What goes out: the selected cards that are done, in the upload order (closing card last), as ONE multi-photo post,
  with the caption as shown in the caption box (saved to the post first).
- Posting or scheduling marks the post posted (posted_at = now, or the scheduled time). The panel shows "Posted · View
  on Facebook", "Scheduled for <time> · Cancel schedule", or the error in plain words.
- Until the Facebook keys are set, the buttons are disabled with "Connect Facebook first". Settings shows whether the
  connection works (one check on demand, showing the Page name).

## How (approach A: the website calls the Graph API)
- `lib/facebook/graph.ts` (server-only): Graph API v26.0, every call signed with `appsecret_proof`
  (HMAC-SHA256 of the token keyed with the app secret), 25 s timeout per call, errors mapped to kinds: `auth`
  (190 / 102 / 460 / 463 / 467 / 492 -> "Reconnect Facebook"), `blocked` (368), `rate` (4 / 17 / 32 / 613 / 80001),
  `network` (no answer: nothing is known), `other`.
- Config from Vercel env (all Sensitive): `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`, `FACEBOOK_APP_SECRET`.
  Nothing secret is stored in the database.
- `publishToFacebookAction(postId, { caption, scheduledAt?, retryUnsure? })`:
  1. Lock: one conditional update sets `fb_state = 'publishing'` only when the post has no Facebook post yet
     (`fb_state` null or `failed`; `unsure` only with `retryUnsure`; a `publishing` older than 10 minutes counts as
     `unsure`). No row changed = someone is already posting it.
  2. Sign 1-hour URLs for the selected card files; Facebook fetches them (`/{page}/photos`, `url`,
     `published=false`, plus `temporary=true` when scheduled), 4 at a time. Any upload failure -> `failed` (nothing
     was posted; unpublished uploads are deleted by Facebook after ~24 h), safe to retry.
  3. One `/{page}/feed` call with `attached_media` + `message` (+ `published=false`, `scheduled_publish_time`,
     `unpublished_content_type=SCHEDULED`). A Facebook error answer -> `failed`. No answer at all (network / timeout)
     -> `unsure`: never retried automatically; the owner checks the Page and may "Retry anyway".
  4. Best effort: read the post's `permalink_url`. Save `fb_post_id`, `fb_permalink`, `fb_state`
     (`published` / `scheduled`), `fb_scheduled_for`, status `posted`, `posted_at`.
- `cancelFacebookScheduleAction(postId)`: DELETE the scheduled post, clear the Facebook columns, status back to ready.
- `checkFacebookAction()`: GET the Page name with the configured keys (Settings).

## Data (migration 021)
posts: `fb_post_id text`, `fb_permalink text`, `fb_state text check in ('publishing','published','scheduled','failed','unsure')`,
`fb_scheduled_for timestamptz`, `fb_attempt_at timestamptz`, `fb_error text (<= 500)`. Also in schema.sql.

## Setup (docs/SETUP.md)
Meta app (Business type, use case "Manage everything on your Page"), permissions pages_manage_posts,
pages_read_engagement, pages_show_list, no App Review (only the owner uses it); add privacy policy URL + data deletion
URL + icon and switch the app to **Live** (posts made in Development mode are visible only to the app's role users);
long-lived Page token (no expiry; invalidated by a password change / role loss). First test on a throwaway Page: a
14-photo post and a post scheduled > 24 h ahead, viewed logged out.

## Tests
Graph client (fake fetch: proof signature, params, error kinds), the actions (fake Supabase: lock, order, caption,
schedule window, failed vs unsure, cancel, not configured), migration 021 (PGlite), the panel (states, disabled when
not connected).
