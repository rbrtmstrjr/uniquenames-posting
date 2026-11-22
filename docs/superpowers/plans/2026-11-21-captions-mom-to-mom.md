# Mom-to-Mom Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unique Names post captions talk mom-to-mom, name the post's theme within the first 100 characters, and never describe the photoshoot set.

**Architecture:** The caption engine (`lib/ai/caption.ts`, `lib/ai/caption-core.ts`) gains two pack flags (`titleOnly`, `themeFirst`) and a hard "required" check, all off by default so the Name Nest pack is unchanged. Task 2 turns them on for Unique Names and rewrites its system prompt and six style guides. Task 3 adds a sample script and produces ~12 real captions for the owner to approve before merge.

**Tech Stack:** TypeScript, Next.js 16 server code, Gemini/Claude through `lib/ai/provider.ts` (`aiJson`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-captions-mom-to-mom-design.md`. Branch: `feature/captions-mom-to-mom`, created from `main` AFTER `feature/autopilot` is merged (this plan builds on Autopilot's `nameTheme` caption support).

## Global Constraints

- English only: never a Filipino or Tagalog word or Taglish (today's rule and `plainWordsProblem` stay).
- The prompt asks for the theme within the first **100** characters; the check (which finds the theme by its key words, e.g. "start with R") allows **120**.
- No set description: no props, outfit, colours, lighting, backdrop or setting; the AI gets only the photoshoot title, for the hashtag.
- Six style ids stay exactly: `story`, `spotlight`, `question`, `choice`, `fact`, `compliment` (stored in `posts.caption_style`; rotation unchanged).
- Unchanged: 1 or 2 short sentences, `CAPTION_MAX` limit, at most one emoji, at most one genuine question, no engagement bait (no comment / tag / share / like / follow asks), names only from the post's list with their given meanings, never the number of names, differ from recent captions, hashtag rules and composition.
- Other packs (Name Nest) unchanged: the new behavior is behind `PackCaptions.titleOnly` / `PackCaptions.themeFirst`, set only by Unique Names.
- On this PC vitest only starts under the PowerShell tool (not Git Bash).
- Commits: only your files, by path (the owner has unrelated uncommitted edits); message ends with the Co-Authored-By trailer from the session's attribution reminder.

---

### Task 1: Caption engine: title-only prompts, theme-first hard check, Rewrite keeps the name theme

**Files:**
- Modify: `packs/types.ts` (`PackCaptions`)
- Modify: `lib/ai/caption-core.ts` (`askCaption`)
- Modify: `lib/ai/caption.ts` (`captionPrompt`, new `themePhrase`, `themeLeadProblem`, `THEME_LEAD_CHARS`, `aiCaptionLine`)
- Modify: `lib/actions/posts.ts` (`rewriteCaptionAction`)
- Test: `tests/caption-theme-first.test.ts` (new)

**Interfaces:**
- Produces: `PackCaptions.titleOnly?: boolean`, `PackCaptions.themeFirst?: boolean`; `askCaption({..., required?: (line: string) => string | null})`; `THEME_LEAD_CHARS = 100` (what the prompt asks); `THEME_CHECK_CHARS = 120` (what the check allows); `themePhrase(input: Pick<CaptionInput, "gender" | "series" | "letter" | "initials" | "nameTheme">): string`; `themeLeadProblem(line: string, input: Pick<CaptionInput, "gender" | "series" | "letter" | "initials" | "nameTheme">): string | null`.

- [ ] **Step 1: Write the failing test** — `tests/caption-theme-first.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// The pack is mocked so the flags can be switched per test (Unique Names turns them on in Task 2).
const pack = vi.hoisted(() => ({ captions: { titleOnly: false, themeFirst: false } as Record<string, unknown> }));
vi.mock("@/packs", async (real) => {
  const mod = await real<typeof import("@/packs")>();
  const base = mod.activePack();
  return { ...mod, activePack: () => ({ ...base, captions: { ...base.captions, ...pack.captions } }) };
});
const { generateJson } = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ generateJson }));
const { THEME_CHECK_CHARS, THEME_LEAD_CHARS, aiCaptionLine, captionPrompt, themeLeadProblem, themePhrase } = await import("@/lib/ai/caption");

const theme = { title: "Country Barn Boy", backdrop: "barn red wall", outfit: "denim overalls", props: "plush cow", lighting: "golden light", palette: "red, cream" };
const ok = (caption: string) => ({ ok: true, data: { caption, tags: [] } });

beforeEach(() => { generateJson.mockReset(); pack.captions = { titleOnly: false, themeFirst: false }; });

describe("theme phrase and the 100-character rule", () => {
  it("names the theme of each kind of post", () => {
    expect(themePhrase({ gender: "girl", letter: "R" })).toBe("baby girl names that start with R");
    expect(themePhrase({ gender: "boy", nameTheme: { title: "Biblical", hint: null } })).toBe("Biblical baby boy names");
    expect(themePhrase({ gender: "boy", initials: "AR" })).toBe("baby boy names with the initials A & R");
    expect(themePhrase({ gender: "girl", series: { part: 1 } })).toBe("Part 1 of our A to Z baby girl names");
    expect(themePhrase({ gender: "girl" })).toBe("baby girl names");
    expect(THEME_LEAD_CHARS).toBe(100);
    expect(THEME_CHECK_CHARS).toBe(120);
  });
  it("passes when the theme is named near the start, also after a short feeling question; fails past 120 characters", () => {
    const i = { gender: "girl" as const, letter: "R" };
    expect(themeLeadProblem("Still looking for a girl name that's sweet but not too common? 💕 These baby girl names that start with R might be the one.", i)).toBeNull();
    const late = `${"A soft and gentle opening line about the joy of waiting for a baby, ".repeat(2)}these baby girl names that start with R.`;
    expect(themeLeadProblem(late, i)).toMatch(/too late/);
    expect(themeLeadProblem("Sweet names for your little one.", i)).toMatch(/does not name/);
  });
  it("plain posts need boy / girl names (close wording accepted), for the right gender", () => {
    expect(themeLeadProblem("Looking for something sweet? These baby girl names feel just right.", { gender: "girl" })).toBeNull();
    expect(themeLeadProblem("Sweet names for your daughter, each one easy to love.", { gender: "girl" })).toBeNull();
    expect(themeLeadProblem("Strong boy names your son can grow into.", { gender: "girl" })).toMatch(/does not name/);
    expect(themeLeadProblem("Names for your son that feel strong and kind.", { gender: "boy" })).toBeNull();
  });
  it("name themes match on the theme's first word", () => {
    expect(themeLeadProblem("Want a name with faith in it? These Biblical baby boy names carry strength.", { gender: "boy", nameTheme: { title: "Biblical", hint: null } })).toBeNull();
  });
});

describe("captionPrompt flags", () => {
  it("titleOnly: only the photoshoot title, marked for hashtags; no set details", () => {
    pack.captions = { titleOnly: true, themeFirst: false };
    const p = captionPrompt({ theme, gender: "boy", captionStyle: "question", letter: "R" });
    expect(p).toContain("Photoshoot title (only for the hashtags; do not describe the photos): Country Barn Boy");
    for (const v of [theme.backdrop, theme.outfit, theme.props, theme.lighting, theme.palette]) expect(p).not.toContain(v);
  });
  it("without the flag the set details are still sent (other packs)", () => {
    const p = captionPrompt({ theme, gender: "boy", captionStyle: "question" });
    for (const v of Object.values(theme)) expect(p).toContain(v);
  });
  it("themeFirst: the prompt states the theme phrase and the 100-character rule", () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    const p = captionPrompt({ theme, gender: "girl", captionStyle: "question", nameTheme: { title: "Soft and cool", hint: null } });
    expect(p).toContain("This post's theme: Soft and cool baby girl names.");
    expect(p).toContain("within the first 100 characters");
  });
});

describe("the hard check", () => {
  it("a caption that names the theme too late is retried and never kept", async () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    generateJson.mockResolvedValue(ok("Sweet names for your little one, picked with love."));
    expect(await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" })).toBeNull();
    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(generateJson.mock.calls[1][0].prompt).toMatch(/does not name/);
  });
  it("the retry that fixes it is kept", async () => {
    pack.captions = { titleOnly: true, themeFirst: true };
    generateJson.mockResolvedValueOnce(ok("Sweet names for your little one, picked with love."))
      .mockResolvedValueOnce(ok("Still looking for something sweet? These baby girl names that start with R might be the one."));
    expect((await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" }))?.line).toMatch(/start with R/);
  });
  it("without themeFirst nothing changes", async () => {
    generateJson.mockResolvedValue(ok("Sweet names for your little one, picked with love, these baby girl names that start with R."));
    expect(await aiCaptionLine({ theme, gender: "girl", captionStyle: "question", letter: "R" })).not.toBeNull();
  });
});
```

If `@/packs`'s exports differ (check `packs/index.ts` for how `activePack` is exported), mock it the way that file allows; the point is to switch the two flags per test without touching other packs. If Gemini is not the provider in tests (`lib/ai/provider.ts`: Gemini unless `AI_PROVIDER=claude`), make sure `AI_PROVIDER` is unset in this test file (`delete process.env.AI_PROVIDER` in `beforeEach`).

- [ ] **Step 2: Run it to make sure it fails**

Run (PowerShell): `npx vitest run tests/caption-theme-first.test.ts`
Expected: FAIL (`themePhrase` / `themeLeadProblem` / `THEME_LEAD_CHARS` not exported).

- [ ] **Step 3: `packs/types.ts`** — add to `PackCaptions`:

```ts
  /** Send only the photoshoot's title (for its hashtags), never the set details, and tell the AI not to describe the photos. */
  titleOnly?: boolean;
  /** The caption must name the post's theme (letter, name theme, initials, series part, or "boy/girl names") within the
   * first THEME_LEAD_CHARS characters; a caption that still misses it after the retry is never kept. */
  themeFirst?: boolean;
```

- [ ] **Step 4: `lib/ai/caption-core.ts`** — `askCaption` gets a hard check

Add `required?: (line: string) => string | null;` to its options (document it: "a check a caption must pass to be kept at all; a failure earns the corrective retry like `problem`, but such a caption is never returned"). In the loop, right after the `plainWordsProblem` block and before `const result = ...`:

```ts
    const must = o.required?.(line);
    if (must) { note = `\n\nYour last caption ("${line}") ${must}. Write a new one.`; continue; }
```

- [ ] **Step 5: `lib/ai/caption.ts`**

1. Constants and helpers (near the other regexes):

```ts
/** The prompt asks for the theme within this many characters: what a reader sees at a glance. */
export const THEME_LEAD_CHARS = 100;
/** The check finds the theme by its key words (e.g. "start with R" comes a little after "baby girl names"), so it allows a bit more. */
export const THEME_CHECK_CHARS = 120;

type ThemeInput = Pick<CaptionInput, "gender" | "series" | "letter" | "initials" | "nameTheme">;

/** The phrase that names this post's theme (what the prompt asks for). */
export function themePhrase(i: ThemeInput): string {
  const g = i.gender;
  if (i.series) return `Part ${i.series.part} of our A to Z baby ${g} names`;
  if (isLetter(i.letter)) return `baby ${g} names that start with ${i.letter}`;
  if (isInitials(i.initials)) return `baby ${g} names with the initials ${i.initials[0]} & ${i.initials[1]}`;
  if (i.nameTheme) return `${i.nameTheme.title.replace(/\s+names$/i, "")} baby ${g} names`;
  return `baby ${g} names`;
}

/** "boy names", "girl's names", "names for your (baby) son": a plain post names its gender's names. */
const plainRe = (g: Gender) => {
  const who = g === "boy" ? "(?:boy|son)" : "(?:girl|daughter)";
  return new RegExp(String.raw`\b${who}(?:'s)?\s+names\b|\bnames\s+for\s+(?:your\s+|a\s+)?(?:baby\s+|little\s+)?${who}\b`, "i");
};

/** Where this post's theme is first named in `line`, or -1. */
function themeIndex(line: string, i: ThemeInput): number {
  const re = i.series ? partRe(i.series.part)
    : isLetter(i.letter) ? letterRe(i.letter)
      : isInitials(i.initials) ? initialsRe(i.initials)
        : i.nameTheme ? new RegExp(`(?<!\\p{L})${escapeRe(themeWord(i.nameTheme.title))}`, "iu")
          : plainRe(i.gender);
  return re.exec(line)?.index ?? -1;
}

/** Why the caption does not lead with the theme (null = it does). */
export function themeLeadProblem(line: string, i: ThemeInput): string | null {
  const at = themeIndex(line, i);
  if (at === -1) return `does not name the post's theme ("${themePhrase(i)}")`;
  if (at > THEME_CHECK_CHARS) return `names the theme too late: say "${themePhrase(i)}" in the first sentence or right after one short opening line`;
  return null;
}
```

`themeWord`, `escapeRe`, `partRe`, `letterRe`, `initialsRe` already exist in the file; move `themeWord` above `themeIndex` if needed. Import `Gender` if not imported.

2. `captionPrompt`: read the pack once (`const pack = activePack().captions;`) and replace the six theme lines with:

```ts
    ...(pack.titleOnly
      ? [`Photoshoot title (only for the hashtags; do not describe the photos): ${t(theme.title)}`]
      : [`Photoshoot theme: ${t(theme.title)}`, `Backdrop: ${t(theme.backdrop)}`, `Outfit: ${t(theme.outfit)}`,
        `Props: ${t(theme.props)}`, `Lighting: ${t(theme.lighting)}`, `Colors: ${t(theme.palette)}`]),
```

and, after the name-theme block and before the recent captions:

```ts
  if (pack.themeFirst) {
    lines.push("", `This post's theme: ${themePhrase(input)}. Name it in the first sentence, or right after one short opening line (within the first ${THEME_LEAD_CHARS} characters).`);
  }
```

3. `aiCaptionLine`: pass the hard check when the pack asks for it:

```ts
  const themeFirst = !!activePack().captions.themeFirst;
  return askCaption({
    system: CAPTION_SYSTEM, prompt: captionPrompt(input), maxTags: 3, max: CAPTION_MAX, min: CAPTION_MIN, timeoutMs, label: "aiCaption",
    problem: (line) => captionProblem(line, input),
    ...(themeFirst ? { required: (line: string) => themeLeadProblem(line, input) } : {}),
  });
```

- [ ] **Step 6: Rewrite caption keeps the name theme** — `lib/actions/posts.ts` `rewriteCaptionAction`

After `const initials = ...` add:

```ts
  // An Autopilot name-theme post (022) keeps naming its theme, with its theme tag.
  const nameTheme = p.name_theme
    ? { title: p.name_theme, hint: parseNameThemes((settings as SettingsRow).autopilot_name_themes)
        .find((x) => x.title.toLowerCase() === p.name_theme!.toLowerCase())?.hint ?? null }
    : null;
```

pass `nameTheme` to `aiCaptionLine({ ..., initials, nameTheme })` and `nameTheme: nameTheme?.title ?? null` to `composePostCaption({ ... })`. Import `parseNameThemes` from `@/lib/autopilot/name-themes`. Add a test to `tests/caption-actions.test.ts` (follow that file's mocking pattern): Rewrite caption on a post with `name_theme: "Biblical"` sends a prompt mentioning "biblical names" and the saved caption carries `#biblicalnames`.

- [ ] **Step 7: Run the tests**

Run (PowerShell): `npx vitest run tests/caption-theme-first.test.ts tests/caption-actions.test.ts tests/ai-caption.test.ts tests/letter-actions.test.ts tests/autopilot-name-themes.test.ts`, then `npx tsc --noEmit` and `npm run lint`.
Expected: all pass (the flags are off for every pack, so existing caption tests are unchanged).

- [ ] **Step 8: Commit**

```bash
git add packs/types.ts lib/ai/caption-core.ts lib/ai/caption.ts lib/actions/posts.ts tests/caption-theme-first.test.ts tests/caption-actions.test.ts
git commit -m "feat(captions): title-only prompts and a theme-first hard check (pack flags), Rewrite keeps the name theme"
```

---

### Task 2: Unique Names' mom-to-mom voice

**Files:**
- Modify: `packs/unique-names/captions.ts`
- Test: `tests/unique-names-captions.test.ts` (new); existing caption tests updated only where they pin the old Unique Names wording or prompt

**Interfaces:**
- Consumes: Task 1's `titleOnly`, `themeFirst`, `themeLeadProblem`, `themePhrase`.
- Produces: `UNIQUE_NAMES_CAPTIONS` with the new `postSystem`, `STYLE_GUIDE`, `titleOnly: true`, `themeFirst: true`.

- [ ] **Step 1: Write the failing test** — `tests/unique-names-captions.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { UNIQUE_NAMES_CAPTIONS } from "@/packs/unique-names/captions";
import { CAPTION_STYLES } from "@/lib/captions/styles";

const sys = UNIQUE_NAMES_CAPTIONS.postSystem(240);
const guide = (s: (typeof CAPTION_STYLES)[number], g: "boy" | "girl" = "girl") => UNIQUE_NAMES_CAPTIONS.styleGuide[s](g);

describe("Unique Names captions: mom-to-mom, theme first", () => {
  it("turns on title-only prompts and the theme-first check", () => {
    expect(UNIQUE_NAMES_CAPTIONS.titleOnly).toBe(true);
    expect(UNIQUE_NAMES_CAPTIONS.themeFirst).toBe(true);
  });
  it("the system prompt: mom-to-mom voice, theme early, never the set, English only, examples for tone only", () => {
    expect(sys).toMatch(/one mom talks to another/);
    expect(sys).toMatch(/Never describe the photos/);
    expect(sys).toMatch(/never a Filipino or Tagalog word or Taglish/);
    expect(sys).toMatch(/for tone only: never copy/);
    expect(sys).not.toMatch(/talk about the set/);
    expect(sys).toMatch(/at most 220 characters/);
  });
  it("six angles: no-name angles never name names; name angles do", () => {
    for (const s of ["question", "story", "compliment"] as const) expect(guide(s)).toMatch(/Do not name any names/);
    for (const s of ["spotlight", "fact", "choice"] as const) expect(guide(s)).toMatch(/names? from the list/);
    expect(guide("question")).toMatch(/^Feeling question\./);
    expect(guide("story")).toMatch(/^Mom's moment\./);
    expect(guide("compliment")).toMatch(/^Encouragement\./);
    expect(guide("spotlight")).toMatch(/^Meaning hook\./);
    expect(guide("fact")).toMatch(/^Name teaser\./);
    expect(guide("choice", "boy")).toMatch(/^A or B\..*your son/);
    for (const s of CAPTION_STYLES) expect(guide(s)).not.toMatch(/prop|outfit|light|photoshoot/i);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run (PowerShell): `npx vitest run tests/unique-names-captions.test.ts`
Expected: FAIL (flags undefined, old wording).

- [ ] **Step 3: Rewrite `packs/unique-names/captions.ts`** (keep `reelSystem` exactly as it is)

```ts
/** The post caption system prompt (`maxChars` = CAPTION_MAX). Mom-to-mom, theme first (2026-11-21). */
const postSystem = (maxChars: number) => [
  "You write the Facebook post caption for @unique_names, a page where moms and moms-to-be find unique baby names.",
  "Each post is an album of baby name cards (a name and its meaning on each photo), all on one theme: a letter, a name theme such as Biblical names, or a pair of initials.",
  `Write 1 or 2 short sentences (at most ${maxChars - 20} characters in total) in the angle the prompt asks for.`,
  "Talk the way one mom talks to another: warm, simple, everyday English a busy mom gets at a glance, speaking to the reader (you, your baby, your daughter, your son). Catchy, never salesy or flowery.",
  "Name the post's theme exactly as the prompt gives it, in the first sentence or right after one short opening line, so readers see at once what the album is.",
  "Never describe the photos: no props, outfits, colors, lighting, backdrop or setting. Talk about the names and the feeling of choosing one.",
  "The readers are moms around the world, most in the Philippines: simple English anyone understands, no region-specific slang, and never a Filipino or Tagalog word or Taglish (no anak, mahal, ganda, salamat, naman, lang, mga), even next to a Filipino name.",
  "This is a page, not a person: never write as if a real baby or family exists (no my baby, our little one, we loved).",
  "Every caption must read clearly different from the recent captions in the prompt: a different opening word, a different sentence shape and a different question. Never reuse their phrases.",
  "Avoid stock openers and cliches such as Get ready, Look no further, Introducing, These lovely, Calling all, swoon.",
  "Only mention a name when the angle asks for one, and then only names from the list in the prompt, spelled exactly. When you say what a name means, use only the meaning given for it: never invent a meaning, an origin or a fact.",
  "Do not mention how many names there are.",
  "At most one question, and it must be genuine and open. Never engagement bait: no comment YES, tag a friend, share if, like if, in the comments, and never ask anyone to follow, like, share or save.",
  "Use at most one emoji, or none. No hashtags in the caption, no @mentions, no links, no quotation marks.",
  "Examples of the tone (for tone only: never copy their words or their shape):",
  "- Still looking for a girl name that's sweet but not too common? 💕 These baby girl names that start with R might be the one.",
  "- Choosing a name is one of the first gifts you give your baby. These Biblical baby boy names carry faith and strength 🙏",
  "- Rosalie, Raya or Reign? Baby girl names that start with R, each one pretty enough to say all day.",
  "- Want a name your son can be proud of? These Biblical baby boy names all have a meaning worth keeping.",
  "- Imagine calling her name across the room for the very first time. These soft and cool baby girl names make that moment sweet.",
  "- Kai or Kian for your little boy? Baby boy names that start with K, short and easy to love.",
  "Also suggest 1 or 2 hashtags for this photoshoot's title (e.g. #countrybarnboy, #oceanbaby), not generic baby-name tags like #babynames or #babyboynames: lowercase letters and digits only, at most 24 characters, right for the post's gender, never #fyp, #foryou, #follow..., #viral or other bait, no other platforms' tags (#tiktok...), and not one of the recent hashtags.",
  "Return JSON: {\"caption\": \"...\", \"tags\": [\"#...\"]}.",
].join("\n");

const kid = (g: Gender) => (g === "girl" ? "daughter" : "son");

/** The six angles (the style ids are shared with the history; only the wording is Unique Names'). */
const STYLE_GUIDE: Record<CaptionStyle, (g: Gender) => string> = {
  question: (g) => `Feeling question. Open with one soft, genuine question about what a mom feels while looking for a ${g} name (for example wanting something sweet but not too common), then name the theme. No second question. Do not name any names.`,
  story: (g) => `Mom's moment. Open with one small, relatable moment of choosing or using a name (saying it out loud, calling your ${kid(g)} by it for the first time), then name the theme. Do not name any names.`,
  compliment: (g) => `Encouragement. Open with one kind, specific line to moms and moms-to-be about choosing a name for their ${kid(g)}, then name the theme. A question is optional. Do not name any names.`,
  spotlight: (g) => `Meaning hook. Name the theme and feature 1 or 2 names from the list with their given meanings, framed for a mom (a name your ${kid(g)} can be proud of, a name that means something). You may end with a short open question.`,
  fact: (g) => `Name teaser. Open with 2 or 3 names from the list as a playful line (for example Name, Name or Name?), then name the theme in a warm line about baby ${g} names. Add a meaning only if it is given.`,
  choice: (g) => `A or B. Pick two names from the list and ask which one readers would choose for their ${kid(g)} (for example Name or Name for your ${kid(g)}?), and name the theme. You may add the meaning of one or both.`,
};
```

and export `{ postSystem, styleGuide: STYLE_GUIDE, reelSystem, titleOnly: true, themeFirst: true }`. Update the file's top comment ("moved word for word ..." no longer true for the post prompt): "Unique Names captions: the post prompt and styles are the mom-to-mom, theme-first voice (spec 2026-11-21); the reel prompt is unchanged."

- [ ] **Step 4: Run the new test, then the existing caption suites**

Run (PowerShell): `npx vitest run tests/unique-names-captions.test.ts`, then `npm test`.
Existing tests may now fail where they pinned Unique Names' OLD behavior (e.g. "carries every theme field" in `tests/ai-caption.test.ts`, old style-guide text, mocked AI captions that never name the theme early so the template is used now). Update ONLY those assertions/fixtures, keeping each test's intent: e.g. assert the title-only prompt instead of every theme field; give mocked AI captions a theme within the first 100 characters (e.g. "... baby boy names that start with K ..."). List every test you changed, and why, in your report. Do not weaken bait / Filipino-word / names-from-list checks.

- [ ] **Step 5: Typecheck and lint**

Run (PowerShell): `npx tsc --noEmit` and `npm run lint`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packs/unique-names/captions.ts tests/unique-names-captions.test.ts <each existing test file you updated>
git commit -m "feat(captions): Unique Names talks mom-to-mom and leads with the post's theme"
```

---

### Task 3: Sample captions for the owner

**Files:**
- Create: `scripts/caption-samples.ts`

**Interfaces:**
- Consumes: `aiCaptionLine`, `CaptionInput` (`lib/ai/caption.ts`), `CAPTION_STYLES` (`lib/captions/styles.ts`).

- [ ] **Step 1: Write the script** — `scripts/caption-samples.ts`

```ts
// Caption samples for the owner (spec 2026-11-21): 12 real AI captions in the Unique Names voice, printed as Markdown.
// Uses the same AI as the site (AI_PROVIDER, GEMINI_API_KEY / ANTHROPIC_API_KEY from .env.local; nothing is printed
// about the keys). Costs well under a cent. Run:
//   npx tsx --conditions=react-server scripts/caption-samples.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  const f = join(process.cwd(), ".env.local");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^(AI_PROVIDER|GEMINI_API_KEY|ANTHROPIC_API_KEY)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
type Input = import("@/lib/ai/caption").CaptionInput;

const set = (title: string) => ({ title, backdrop: "-", outfit: "-", props: "-", lighting: "-", palette: "-" });
const POSTS: (Omit<Input, "captionStyle" | "recent"> & { label: string })[] = [
  { label: "Letter R · girl", gender: "girl", style: "single", letter: "R", theme: set("Farmyard Friends"),
    names: [{ name: "Rosalie", meaning: "rose" }, { name: "Raya", meaning: "friend" }, { name: "Reign", meaning: "to rule" }] },
  { label: "Letter K · boy", gender: "boy", style: "single", letter: "K", theme: set("Little Gentleman"),
    names: [{ name: "Kai", meaning: "the sea" }, { name: "Kian", meaning: "ancient" }, { name: "Kenji", meaning: "strong and healthy" }] },
  { label: "Biblical · boy", gender: "boy", style: "single", nameTheme: { title: "Biblical", hint: null }, theme: set("Olive Grove Boy"),
    names: [{ name: "Ezekiel", meaning: "god strengthens" }, { name: "Josiah", meaning: "god supports" }, { name: "Gideon", meaning: "great warrior" }] },
  { label: "Soft and cool · girl", gender: "girl", style: "single", nameTheme: { title: "Soft and cool", hint: null }, theme: set("Cloud Nine Girl"),
    names: [{ name: "Luna", meaning: "the moon" }, { name: "Wren", meaning: "small songbird" }, { name: "Mila", meaning: "gracious and dear" }] },
];

async function main() {
  loadEnv();
  // Imported after the keys are loaded (the AI modules read them when called).
  const { aiCaptionLine } = await import("@/lib/ai/caption");
  const { CAPTION_STYLES } = await import("@/lib/captions/styles");
  const recent: string[] = [];
  const out: string[] = ["# Caption samples (mom-to-mom, theme first)", ""];
  let k = 0;
  for (const post of POSTS) {
    for (let j = 0; j < 3; j++) {
      const captionStyle = CAPTION_STYLES[k++ % CAPTION_STYLES.length];
      const { label, ...input } = post;
      const ai = await aiCaptionLine({ ...input, captionStyle, recent: [...recent].reverse().slice(0, 8) }, 20000);
      out.push(`**${label} · ${captionStyle}**`, ai ? ai.line : "_(no AI caption: the template would be used)_", "");
      if (ai) recent.push(ai.line);
    }
  }
  console.log(out.join("\n"));
}

void main();
```

- [ ] **Step 2: Typecheck and lint the script**

Run (PowerShell): `npx tsc --noEmit` and `npm run lint`. Expected: clean (fix types against the real `CaptionInput` if needed).

- [ ] **Step 3: Run it and save the output**

Run (PowerShell): `npx tsx --conditions=react-server scripts/caption-samples.ts > C:\Users\rober\AppData\Local\Temp\claude\7b6020ce5655dad7\1373afda-b2ea-490e-8bec-fadee4e3382f\scratchpad\caption-samples.md`
Expected: 12 captions (each names its theme within the first 100 characters; none describes the photos). If a key is missing, report it instead of guessing. Put the file path and the 12 lines in your report.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/caption-samples.ts
git commit -m "chore(captions): sample script for the owner's review"
```

- [ ] **Step 5: Owner review (controller)**

The controller shows the 12 samples to the owner. Merge only after the owner approves; tune the wording in Task 2's prompt if the owner asks for changes, then re-run the script.
