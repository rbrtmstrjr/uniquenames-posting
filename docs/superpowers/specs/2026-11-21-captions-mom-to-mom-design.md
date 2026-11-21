# Captions: mom-to-mom, theme first (2026-11-21)

## Goal
The AI post captions read like product descriptions of the photoshoot set ("these baby girl names that start with R
sit near a plush cow and felt daisies on barn red, lit warm and bright"), and the post's letter or name theme is buried
mid-sentence. The owner wants catchy captions for the page's audience (mostly Filipino moms) that lead with the post's
name theme and talk the way one mom talks to another.

Owner decisions (2026-11-21): mom-to-mom feeling; English only (no Filipino or Taglish words, as today); rewrite the
AI's caption instructions (not a fixed template list, not small tweaks); show about 12 real sample captions before merge.

## Behaviour (Unique Names only)
1. **The theme leads.** Every caption names the post's theme in its first sentence, or right after one short opening
   line such as a feeling question: the AI is asked to name it within the first 100 characters (what a reader sees at
   a glance), and the check, which finds the theme by its key words such as "start with R", allows up to 120 (the
   owner's chosen sample "Still looking for a girl name that's sweet but not too common? 💕 These baby
   girl names that start with R might be the one." does this). The theme per post:
   - a post by letter: "baby girl names that start with R" (or close wording with the letter, as today's check accepts);
   - an Autopilot name-theme post: the theme ("Biblical baby boy names", "soft and cool baby girl names");
   - a post by initials: "baby boy names with the initials A & R";
   - an old A–Z series part: "Part 1 of our A to Z baby girl names";
   - any other post: "baby boy names" / "baby girl names".
   The app checks it. A caption that misses it gets the usual one corrective retry; if that also misses, the AI caption
   is not used at all: a new post gets the template caption (as today when the AI fails), and Rewrite caption says it
   could not write one and leaves the caption unchanged.
2. **No set description.** The caption never describes the photos (props, outfit, colours, lighting, backdrop). The AI
   gets only the photoshoot's title, and only to suggest the one photoshoot hashtag (as today: e.g. #countrybarnboy).
3. **Mom-to-mom voice.** Warm, plain, simple English a busy mom gets at a glance; speaks to the reader ("you", "your
   daughter", "your son"); the page is a brand, so never "I", "my baby", "we", or a real family.
4. **Six rotating angles** (the same six style ids as today, so history and rotation keep working; only Unique Names'
   wording changes; no two posts in a row share one, least recently used first, as today):
   - `question` → **feeling question**: opens with a soft, genuine question about what a mom feels while choosing
     ("Still looking for a girl name that's sweet but not too common?"), then the theme. No names.
   - `story` → **mom's moment**: one small, relatable moment of choosing or using a name ("Imagine calling her name
     across the room for the first time"), then the theme. No names.
   - `compliment` → **encouragement**: a kind line to moms and moms-to-be ("Choosing a name is one of the first gifts
     you give your baby"), then the theme. No names.
   - `spotlight` → **meaning hook**: 1 or 2 of the post's names with their real meanings, framed for a mom ("a name
     your son can be proud of").
   - `fact` → **name teaser**: 2 or 3 of the post's names as a playful opener ("Rosalie, Raya or Reign? 💕"), then the
     theme; a meaning only if given.
   - `choice` → **A or B**: two of the post's names, which would you pick for your daughter / son; one meaning optional.
   The style each post gets is stored as today (`posts.caption_style`).
5. **Examples.** The system prompt carries about six short example captions in this voice (two per kind of theme),
   with the rule: use them for tone only; never copy their wording.
6. **Unchanged rules:** 1 or 2 short sentences within today's length limit; at most one emoji; at most one question and
   only a genuine one; no engagement bait (no comment/tag/share/like/follow asks); names only from the post's list,
   spelled exactly, with only their given meanings; never the number of names; different from the recent captions
   (opening word, sentence shape, question); no hashtags, mentions, links or quotes in the line; the hashtag rules and
   the composed hashtag set as today.
7. **Where it applies:** new posts (Today's Generate, Autopilot) and **Rewrite caption**. Captions of posts already
   made or scheduled are not changed. Rewrite caption on an Autopilot name-theme post keeps its theme (it passes the
   post's name theme to the caption, as it already does for a letter or initials).

## How
- `packs/unique-names/captions.ts`: new `postSystem` (voice, theme-first rule, no set description, examples) and new
  `STYLE_GUIDE` wording for the six ids.
- `PackCaptions` (packs/types.ts) gains two optional flags, both on for Unique Names and off (absent) for other packs,
  so Name Nest's captions do not change:
  - `titleOnly: true` — `captionPrompt` sends only the photoshoot title (for the hashtag), not backdrop / outfit /
    props / lighting / colours, and says not to describe the photos;
  - `themeFirst: true` — `captionPrompt` states the exact theme phrase, and a hard check requires the theme to start
    within the first 100 characters (`askCaption` gains an optional `required` check: a caption failing it is retried
    and never kept). For a post with no letter / name theme / initials / series, the caption must say "boy names" /
    "girl names" (close wording accepted: "names for your baby girl", "names for your son").
- `lib/ai/caption.ts`: `captionPrompt` reads those flags; `aiCaptionLine` passes the hard check when `themeFirst` is on.
  Nothing else changes (hashtags, template fallback, history).

## Testing
- Prompt: with `titleOnly`, no backdrop / outfit / props / lighting / palette text in the prompt; the title is there,
  marked as for the hashtag only; the theme phrase line is there for letter, name-theme, initials, series and plain
  posts. Name Nest's prompt unchanged (existing tests stay green).
- The theme check with `themeFirst`: the theme first found after 120 characters fails, before that passes (also after
  a short feeling question); plain posts need "boy/girl names" (or the accepted variants) there; a caption that still
  fails after the retry is never kept (template / Rewrite fails).
- Style guides: each of the six ids has Unique Names wording; the name styles still name names, the others don't.
- A live sample: about 12 captions from the real AI (letters, name themes, both genders, all six angles) shown to the
  owner before merge.
