# Front card and the 3 best names first (2026-11-21)

## Goal
On a phone, Facebook shows only the first 4 pictures of an album. The first one should tell viewers at once what
the post is ("'S' Names for baby boy"). The next three should be the post's most appealing names, so the 4
pictures a viewer sees are the strongest hook.

Owner decisions (2026-11-21):
- The front card is a photo plus a big title (approach A: a new card kind the PC makes, like the closing card).
- Its pose and angle change from post to post, so it never looks templated.
- The 3 best are picked by name: the AI ranks names the way a parent would.
- Autopilot posts stay at 10 to 16 cards in total, so 8 to 14 names.
- A post may go out with 7 passed name cards.

## Behaviour (Unique Names)

### Order of the album
1. The **front card**.
2. The **3 best names**: the post's top 3 by the ranking below.
3. The **other names**.
4. The **closing card**, last as today.

The front card stays first and the closing card stays last when the owner drags cards on the post page. Facebook
(Post now, Schedule), Download and the upload numbers all follow this order. If a top-3 card is unselected or
removed, the next card in the order simply moves up.

### The front card
- **Photo:** the post's own set, outfit and child, like the closing card. It uses a **cover pose** from a pool of
  about 10. Examples:
  - a wide shot of the whole set;
  - a close-up face looking at the camera;
  - top-down on the blanket;
  - peeking over or around a prop;
  - a side profile looking up;
  - sitting among the props at a three-quarter angle;
  - hugging a soft prop from the set;
  - tummy time with the chin on the hands;
  - an over-the-shoulder look at the set;
  - a low angle with the backdrop rising behind.

  Each pose has a version for each age session (newborn, sitter, toddler, kid), so a newborn is never asked to
  crawl. The feet and skin rules of every card apply. The photo is text-free, and the title is stamped by code.
- **Never templated:**
  - The pose is the least recently used one among recent front cards, and never the previous post's pose.
  - The title's place (top or bottom of the card) alternates from post to post. The photo leaves calm, open space
    where the title goes.
  - The place is stored with the card, so a re-stamp keeps it.
- **Title** (stamped big in the Settings title font, larger than a name; a smaller second line in the meaning font;
  the handle small, as on other cards):

  | Post | Main line | Second line |
  |---|---|---|
  | By letter | 'S' Names | for baby boy |
  | Autopilot name theme | Biblical Names (the theme title + "Names", unless it already ends in "names") | for baby girl |
  | By initials | A & R Names | for baby girl |
  | Old A–Z series part | A to Z Names | part 1 · for baby girl |
  | Any other | Baby Boy Names | (none) |

- **Where:** every new Unique Names post: Today (single names and initials) and Autopilot.
  - Settings gets a **Front card** on/off switch next to the closing card's, on by default.
  - Today posts keep the number of names the owner picks; the front card is one more card, like the closing card.
  - Posts already made or scheduled do not change.
  - A pack without front-card wording and cover poses (Name Nest) never gets one.
- **Edits:** New picture, Retry and Re-stamp work on the front card as on any card. It has no name, so the name swap
  doesn't apply to it.

### The 3 best names
- **Autopilot:** Claude Opus's existing parent's-eye check (one call per batch) also returns an `appeal` score from
  1 to 10 for each good name: "how much would a parent love to choose it", meaning pretty, meaningful, easy to say,
  special.
  - The post's names are ordered with the top 3 by appeal first, then the rest in random order.
  - No extra AI call is made.
- **Today (single names and initials):** when the post is made, one AI call ranks its names.
  - It uses the app's AI setting, the same AI as the captions.
  - It runs alongside the caption, so Generate is not slower.
  - It has a time limit of about 8 s. If it fails or is late, the post is made in today's order. It never blocks
    or fails the post.
  - Its answer is checked in code: only the post's own names, each once. Anything else is ignored.

### Autopilot
- **Names per post:** 8 to 14, plus the front and closing cards, so 10 to 16 cards in total.
- **Front card check:**
  - The front card is photo-checked and remade like every card. The judge is told its stamped text is the post's
    title.
  - It is part of the look-alike check. If it is flagged, it is remade once like any flagged card.
- **Front card that keeps failing:** if it still fails after its 2 remakes, it is unselected. The post goes out
  without it (not held), and the run's activity says so ("Front card left out: hands").
- **Minimum to post:** a post goes out with **7 or more passed name cards** (it was 8). The names step still needs
  8 good names to make the post (MIN_GOOD_NAMES stays 8).

## How
- **Migration 023 (safe to run twice):**
  - `cards.kind` also allows `cover`.
  - `settings.cover_enabled` boolean, default true.
  - `cards.title_pos` text, null, check `top` / `bottom`: the front card's title place (null on every other card).
- **Planner (pack):**
  - The cover pose pool and the title wording live in the Unique Names pack.
  - `planCoverCard` mirrors `planCtaCard`: the same set and child, the chosen pose, and a prompt that keeps the
    title's half calm.
  - The front card is added when the post is created, next to the closing card (`addClosingCard`'s pattern). It is
    placed first, at position 0 / the lowest order.
- **Order:** `cardOrder` sorts `cover` first and `cta` last. The post page's drag keeps both pinned.
- **Ranking:** the Autopilot names judge's schema gets `appeal`, and `pickNames` returns the ids best-first. Today
  and initials posts get a small `rankNames` AI step in post creation. Both feed the cards' order.
- **Worker 2.10.0:**
  - `compose_cover` stamps the title (main line, second line, handle) at the stored place.
  - Claimed `cover` cards are made like the others.
  - The local file is named `00-front.jpg`.
  - The owner restarts the worker when its queue is empty.
- **Facebook / Download:** they already follow `cardOrder`.

## Not included
- A collage front card.
- Adding a front card to existing posts.
- Front cards on reels.
- Ranking by photo quality.

## Testing
- **Order:** `cardOrder` puts the cover first and the cta last; the drag keeps both pinned; upload numbers start at
  the cover.
- **Planner:**
  - the pose comes least recently used and never matches the previous post;
  - the title place alternates;
  - every session has every pose;
  - the title wording is right for letter, name theme, initials, series and plain posts;
  - with the switch off, or a pack without wording, no front card is made.
- **Ranking:**
  - the Autopilot judge's `appeal` is required and checked, and the top 3 by appeal come first;
  - Today's ranking puts the AI's top 3 first;
  - Today's ranking falls back to today's order on an AI failure, a timeout or a bad answer (unknown or repeated
    names).
- **Autopilot:**
  - 8 to 14 names;
  - the front card is checked, remade and included in the look-alike check;
  - a failing front card is left out and the post still goes out;
  - 7 passed name cards are enough, 6 holds the post.
- **Worker:** `compose_cover` at the top and the bottom; long titles fit; the file is named `00-front.jpg`.
- **Migration 023** on PGlite (live database and fresh schema).
- **Live:** one Today post and one Autopilot day, looked at on a phone (the first 4 pictures).
