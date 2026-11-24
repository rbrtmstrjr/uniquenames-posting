# US names: names for the US, Canada, the UK and Australia (2026-11-24)

## Goal
The posts reach millions. Most viewers are now in Kenya, Nigeria, Zambia, South Africa and Cameroon. Those
countries pay almost nothing: $0.01 per 1,000 qualified views on a 1.4M-view post.

The names are the main signal we control, and they point the wrong way:
- The AI that suggests names is told to pick from "any culture (... Arabic, Japanese, Yoruba, Sanskrit ...)" and to
  "skip any name in the US top 100".
- The last 14 posts were full of names like Vikram, Vishnu, Vedant, Tanvi, Tejas, Sunita, Sakura, Takeshi, Tariq,
  Qadeer and Uzima.
- The 1,094-name library has no US popularity data at all.

Every name Unique Names uses should now be one that parents in the US, Canada, the UK and Australia actually give.
Those are the high-paying countries. Filipino moms, the followers, know these names well.

Owner decisions (2026-11-24):
- Fix the names only: not the post times, not the babies' looks.
- "Unique but known": real US names, not the top 100, within about the top 2,000.
- Old library names that don't fit are skipped, never deleted, and the owner can bring any back.

Facebook decides who sees a post, so this nudges the audience; it doesn't guarantee it. We watch Top countries in
Insights for 1 to 2 weeks after the change.

## Behaviour (Unique Names only; Name Nest unchanged)

### The US list
- Source: the official US Social Security baby-name data (public domain), already used by Name Nest's import
  (`scripts/lib/ssa.ts`).
- For each gender, a name's **best rank over the last 3 years** of data, kept to the top 5,000.
- Saved in the app as a data file, refreshed once a year with a script.
- The script reads the data the same way Name Nest's import does (download, or `--zip <path>`).
- Lookups ignore case and accents: "Zoë" is found as "Zoe".

### What a good name is now
- **Single names:** a girl name must rank **101 to 2,000** on the US girls' list; a boy name the same on the boys'
  list. The top 100 is too common for "Unique Names"; below 2,000 is too unfamiliar.
- **Hard letters:**
  - For a letter where the US list has fewer than **25** names ranked 101 to 2,000 for that gender, the range for
    that letter and gender widens to **101 to 5,000**.
  - The widening is worked out from the list itself, not hand-picked.
  - Today this is likely Q, U, X, Y and Z, and maybe others.
- **Initials posts (first + middle):** both words must be on that gender's US list, top 5,000. The first name must
  not be in the top 100.
- **Names the owner adds by hand** on the Names page from now on are never checked: they are always kept. That is
  the owner's choice.

### Where names come from

**AI suggestions.** This covers By letter, Name ideas (wish), a card's name ideas, and Autopilot's extra rounds.
- The instructions are rewritten: suggest names that parents in the US, Canada, the UK and Australia use today,
  on the unique side but never the top 100, from the name traditions common there.
- No names used mainly in South Asia, the Middle East, East Asia or Africa, unless American parents commonly give
  them.
- Every suggested name is then checked against the US list. A name outside its range is dropped and never saved
  or shown.
- The suggestion calls already ask for a few extra names, which absorbs the drops.
- If a round ends with too few names, the existing behaviour applies: fewer names are shown or saved, and Autopilot
  does another round or holds the post.

**Autopilot.**
- The parent's-eye check now judges as a parent in the US, Canada, the UK or Australia would, keeping in mind that
  Filipino moms read the page too.
- The US list check runs before the Claude check, so no money is spent judging a name that will be dropped.
- Saved names outside the range are not used. The one-time cleanup below skips them, and Autopilot's own stock
  read also filters by the list.

**Today.**
- Today keeps picking from available names in the library.
- After the cleanup the library holds only names in range, plus the owner's own and restored names.

### One-time library cleanup
The Names page gets a **Check names against the US list** button. It works in two steps.
1. It shows how many available names are outside their range, for example "812 names aren't US names. Skip them?".
2. On confirm, those names are set to **Skip** with the note "Not a US name". Nothing is deleted.

Which names it touches:
- Only **available** names. Names already used in posts, and names already skipped, are left alone.
- A name the owner brings back (available again, with the "Not a US name" note) is never skipped again by a later
  run.
- The app doesn't record who added a name, so the cleanup checks every available name, the owner's own included.
  The owner can bring back any of their own on the Names page; filtering Skip with the note shows them. A restored
  name stays.

The US rank is written to each checked name, in the existing `names.us_rank` / `us_year` columns. The Names page
shows it, for example "US #234".

### Not changed
- Posts already made or scheduled.
- Captions.
- Post times and the babies' looks.
- Name Nest.
- The front card and the 3-best ranking. These work on whatever names are chosen.

## How
- `scripts/import-us-names.ts` builds the data file `packs/unique-names/us-names.json` from the SSA data, using
  `scripts/lib/ssa.ts`. The file is committed and reviewed like code.
- `lib/names/us-list.ts` (server-only, pure):
  - `usRank(name, gender)`;
  - `usRange(letter, gender)`, which applies the widening rule;
  - `isUsName(name, gender, letter?)`;
  - a two-word check.
- Suggestion paths (lib/ai/suggest.ts, lib/actions/suggest.ts, lib/autopilot/wiring.ts and the names step):
  - the pack's suggestion prompts are rewritten (packs/unique-names/suggest.ts);
  - the list filter is applied before names are saved or returned.
- The Autopilot names judge prompt (lib/autopilot/judge-names.ts) gets the new parent's point of view.
- The cleanup is a server action on the Names page with a preview count and a confirm. It writes `us_rank` and
  `us_year`.
- The Names page row shows the US rank.
- The whole feature is behind the active pack, so Name Nest is unaffected.

## Testing
- **US list:**
  - ranks are found case- and accent-insensitively;
  - the 101 to 2,000 range;
  - widening to 5,000 only for letters with fewer than 25 in range;
  - the two-word check;
  - the data file loads and has both genders.
- **Suggestions:** names outside the range are dropped before saving, for each path. The rewritten prompts name the
  US, Canada, the UK and Australia and no longer list "Yoruba, Sanskrit".
- **Autopilot:**
  - out-of-range names never reach the judge;
  - the judge prompt has the new point of view;
  - the stock filter respects the list.
- **Cleanup:**
  - the preview count;
  - only available names are skipped, with the note;
  - used and already-skipped names are untouched;
  - restored names are never skipped again;
  - `us_rank` is written.
- **Names page:** the US rank is shown.
- **Live:** after the cleanup, the next letter posts on Today and Autopilot use names US moms know. Top countries in
  Insights is checked after 1 to 2 weeks.
