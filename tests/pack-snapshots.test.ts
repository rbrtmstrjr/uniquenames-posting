import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// Golden outputs of the Unique Names page (spec 2026-10-10-niche-packs-name-nest-design): every prompt, caption,
// hashtag set, closing-card message and voice list the web app builds, captured BEFORE the niche-pack extraction and
// kept byte-for-byte afterwards. Fixed inputs and seeded rngs only: the snapshots must never change for the
// unique-names pack (NICHE unset). Do not update them with -u unless an intended Unique Names change is made.
import {
  AGE_CHOICES, SUBJECT_AGES, buildCtaPrompt, buildPrompt, ctaShot, pickSubject, planCtaCard, planExtraCard, planPost,
  randomSubject, seededRandom, sessionShots, PROPS_SPECS, LOOKS, CHILD_LOOKS, type Session,
} from "@/lib/planner";
import type { Gender, NameRow, NameStyle, ThemeRow } from "@/lib/db/types";
import {
  CAPTION_SYSTEM, STYLE_GUIDE, captionPrompt, composePostCaption, templateLine,
} from "@/lib/ai/caption";
import { EMPTY_HISTORY } from "@/lib/captions/history";
import { CAPTION_STYLES } from "@/lib/captions/styles";
import { REEL_SCRIPT_SYSTEM, reelScriptPrompt, GREETING_RE } from "@/lib/ai/reel-script";
import { REEL_FORMATS } from "@/lib/reels/formats";
import { REEL_CAPTION_SYSTEM, reelCaptionPrompt } from "@/lib/ai/reel-caption";
import { IDEAS_SYSTEM, ideasPrompt, buildIdeas, reusesBankMethod } from "@/lib/ai/reel-ideas";
import { REEL_TOPICS, pickTopic, topicById } from "@/lib/reels/topics";
import { pickBankIdeas, templateHook, formatSpread } from "@/lib/reels/topic-ideas";
import { LETTER_SYSTEM, NAMES_SYSTEM, THEMES_SYSTEM, letterPrompt, namesPrompt, themesPrompt } from "@/lib/ai/suggest";
import {
  HASHTAGS_ALWAYS_DEFAULT, HASHTAG_POOL_DEFAULT, legacyPool, pickPostTags, pickReelTags, tagSettings,
} from "@/lib/captions/hashtags";
import { CTA_MESSAGES_DEFAULT, ctaMessagesOf, pickCtaMessage } from "@/lib/cta/messages";
import { HOUSE_VOICES, VOICE_DEFAULT, houseDefault } from "@/lib/reels/voices";
import { REF_TEXT } from "@/lib/ai/tts";
import { guidePreviewPrompt } from "@/lib/reels/guide";

/** A long output's fingerprint: still a byte-for-byte check, without a megabyte snapshot (readable copies are kept for one of each kind). */
const digest = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;
/** A planned card with its prompt as a fingerprint. */
const hashed = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(hashed);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === "prompt" && typeof v === "string" ? digest(v) : hashed(v)]));
  return x;
};

const now = "2026-10-04T00:00:00Z";
const GENDERS: Gender[] = ["boy", "girl"];
const STYLES: NameStyle[] = ["two-word", "single"];
const SESSIONS: Session[] = ["newborn", "sitter", "toddler", "kid"];

const themeRow = (gender: Gender): ThemeRow => ({
  id: `t-${gender}`, title: gender === "boy" ? "Boho Pampas" : "Blush Floral", gender,
  backdrop: "smooth seamless chocolate brown studio backdrop with a soft darker vignette",
  outfit: "a tiny cream knitted romper with a little collar", props: "wicker basket, pampas grass, felt bunny",
  lighting: "soft warm light from the left, gentle shadows, cozy", palette: "brown, cream, oat and soft gold",
  status: "available", sort_order: 1, used_on: null, preview_card_id: null, created_at: now, updated_at: now,
});
let nid = 0;
const nameRow = (nm: string, gender: Gender, style: NameStyle): NameRow => ({
  id: `n${++nid}`, name: nm, meaning: `meaning of ${nm.toLowerCase()}`, gender, style, status: "available",
  post_id: null, position: null, created_at: now, updated_at: now,
});
const NAMES: NameRow[] = GENDERS.flatMap((g) => STYLES.flatMap((s) =>
  Array.from({ length: 16 }, (_, i) => nameRow(s === "two-word" ? `${g === "boy" ? "Arlo" : "Isla"}${String.fromCharCode(65 + i)} Mid${i}` : `${String.fromCharCode(65 + i)}${g}name`, g, s))));
const THEMES = GENDERS.map(themeRow);
const SETTINGS = { caption_template: "Here are some beautiful names you can give to your baby {gender}. 🥰", hashtags: "#parenting #uniquenames", min_images: 9, max_images: 13 };

describe("unique-names golden outputs (niche pack must keep these byte-for-byte)", () => {
  it("card looks", () => {
    expect({ LOOKS, CHILD_LOOKS }).toMatchSnapshot();
  });

  it("card photo prompts: every shot of every session, per gender and age", () => {
    const out: Record<string, string> = {};
    for (const gender of GENDERS) {
      // the original (pre-age) baby
      for (const session of ["newborn", "sitter"] as const) {
        for (const shot of [...sessionShots(session), ...PROPS_SPECS]) {
          out[`${gender}|none|${session}|${shot.text}`] = buildPrompt(themeRow(gender), shot.text, gender, { session, look: LOOKS[1] });
        }
      }
      for (const age of SUBJECT_AGES) {
        const subject = pickSubject(`2026-10-05|${gender}|single`, age);
        for (const shot of sessionShots(subject.session)) out[`${gender}|${age}|${shot.text}`] = buildPrompt(themeRow(gender), shot.text, gender, subject);
        const varied = randomSubject(age, seededRandom(7));
        out[`${gender}|${age}|varied`] = buildPrompt(themeRow(gender), sessionShots(varied.session)[0].text, gender, varied);
      }
      out[`${gender}|no-subject`] = buildPrompt(themeRow(gender), sessionShots("sitter")[2].text, gender);
    }
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, k.startsWith("boy|") ? v : digest(v)]))).toMatchSnapshot();
  });

  it("closing card prompts and shots", () => {
    const out: Record<string, string> = {};
    for (const gender of GENDERS) {
      out[`${gender}|none`] = buildCtaPrompt(themeRow(gender), gender);
      for (const age of SUBJECT_AGES) out[`${gender}|${age}`] = buildCtaPrompt(themeRow(gender), gender, pickSubject(`k|${gender}`, age));
      out[`${gender}|old`] = buildCtaPrompt(themeRow(gender), gender, pickSubject(`k|${gender}`));
    }
    for (const s of SESSIONS) out[`shot|${s}`] = ctaShot(s);
    expect(out).toMatchSnapshot();
  });

  it("planned posts, extra cards and closing cards (gender x style x age)", () => {
    const out: Record<string, unknown> = {};
    for (const gender of GENDERS) for (const style of STYLES) {
      for (const age of [undefined, ...AGE_CHOICES]) {
        const r = planPost({ request: { gender, style, count: null, postDate: "2026-10-05", age }, names: NAMES, themes: THEMES, settings: SETTINGS });
        out[`post|${gender}|${style}|${age ?? "none"}`] = hashed(r);
        const key = `2026-10-05|${gender}|${style}`;
        out[`extra|${gender}|${style}|${age ?? "none"}`] = hashed(planExtraCard({
          theme: themeRow(gender), gender, style, names: NAMES, usedNameIds: [], nextPosition: 12, salt: `post-1|extra`, subjectKey: key, age, usedShots: [],
        }));
        out[`cta|${gender}|${style}|${age ?? "none"}`] = hashed(planCtaCard({
          theme: themeRow(gender), gender, subjectKey: key, age, salt: "post-1", position: 14, text: "Follow for more / baby name ideas.",
        }));
      }
      out[`letter|${gender}|${style}`] = hashed(planPost({ request: { gender, style, count: 9, postDate: "2026-10-06", age: "random", letter: "A" }, names: NAMES, themes: THEMES, settings: SETTINGS }));
    }
    // one readable post, so a diff shows what changed
    const sample = planPost({ request: { gender: "girl", style: "single", count: 10, postDate: "2026-10-07", age: "random" }, names: NAMES, themes: THEMES, settings: SETTINGS });
    expect({ sample, out }).toMatchSnapshot();
  });

  it("post caption prompts and templates", () => {
    const names = NAMES.filter((n) => n.gender === "girl" && n.style === "single").slice(0, 14).map((n) => ({ name: n.name, meaning: n.meaning }));
    const out: Record<string, string> = { CAPTION_SYSTEM };
    for (const gender of GENDERS) {
      for (const captionStyle of CAPTION_STYLES) {
        out[`style|${gender}|${captionStyle}`] = STYLE_GUIDE[captionStyle](gender);
        out[`prompt|${gender}|${captionStyle}`] = captionPrompt({ theme: themeRow(gender), gender, style: "two-word", captionStyle, names });
      }
      out[`prompt|${gender}|series`] = captionPrompt({
        theme: themeRow(gender), gender, style: "single", captionStyle: "spotlight", names, series: { part: 2 },
        recent: ["Tiny boots, big dreams.", "Soft light and softer names."], recentTags: ["#autumnbaby", "#babynames"],
      });
      out[`prompt|${gender}|letter`] = captionPrompt({ theme: themeRow(gender), gender, style: "single", captionStyle: "story", letter: "K" });
      out[`template|${gender}`] = templateLine(gender, SETTINGS.caption_template);
      out[`template|${gender}|series`] = templateLine(gender, SETTINGS.caption_template, { part: 1 });
      out[`template|${gender}|letter`] = templateLine(gender, SETTINGS.caption_template, undefined, "M");
      out[`composed|${gender}|template`] = composePostCaption({ ai: null, aiOn: false, captionStyle: "story", gender, settings: { caption_template: SETTINGS.caption_template }, history: EMPTY_HISTORY }).caption;
      out[`composed|${gender}|ai`] = composePostCaption({
        ai: { line: "A cozy set for little dreamers.", tags: ["#autumnbaby", "#babynames"] }, aiOn: true, captionStyle: "story", gender,
        settings: { caption_template: SETTINGS.caption_template, hashtags_always: null, hashtag_pool: null }, history: EMPTY_HISTORY,
      }).caption;
    }
    expect(out).toMatchSnapshot();
  });

  it("reel script system + prompt for each format, both guide styles and the doll / legacy styles", () => {
    const out: Record<string, string> = { REEL_SCRIPT_SYSTEM, GREETING_RE: GREETING_RE.source };
    const made = [{ title: "The 5-Word Rule", stage: "toddler" }, { title: "Bedtime stalling", stage: null }];
    for (const format of REEL_FORMATS) {
      for (const theme of [{ id: "crayon", faces: true }, { id: "redthread", faces: true }, { id: "knitted", faces: false }, { id: "clay", faces: true }, { id: "papercraft", faces: false }] as const) {
        const p = reelScriptPrompt({ maxScenes: 40, alreadyMade: made, format, theme, speed: 1.05 });
        if (p.system !== REEL_SCRIPT_SYSTEM) throw new Error("system changed per call");
        out[`${format}|${theme.id}|auto`] = p.prompt;
      }
      const bank = REEL_TOPICS.find((t) => t.format === format && t.health && t.facts) ?? REEL_TOPICS.find((t) => t.format === format)!;
      out[`${format}|crayon|topic`] = reelScriptPrompt({
        topic: bank.topic, maxScenes: 24, alreadyMade: [], format, theme: { id: "crayon", faces: true },
        topicHealth: bank.health, topicFacts: bank.facts, topicSafety: bank.safety, topicAnchor: bank.anchor, hookHint: "Your toddler \"hates\" bedtime?",
      }).prompt;
      out[`${format}|redthread|health-generic`] = reelScriptPrompt({ topic: "fever at night", maxScenes: 12, alreadyMade: [], format, theme: { id: "redthread", faces: true }, topicHealth: true }).prompt;
    }
    out.defaultTheme = reelScriptPrompt({ maxScenes: 40, alreadyMade: [], format: "problem_fix" }).prompt;
    const readable = (k: string) => !k.includes("|") || k === "named_method|crayon|auto" || k === "lola_science|redthread|auto" || k === "problem_fix|knitted|auto" || k === "say_this|crayon|topic";
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, readable(k) ? v : digest(v)]))).toMatchSnapshot();
  });

  it("reel caption prompt", () => {
    expect({
      REEL_CAPTION_SYSTEM,
      prompt: reelCaptionPrompt({
        title: "The 5-Word Rule", topic: "tantrums", stage: "toddler", hook: "THE 5-WORD RULE", lines: ["Your toddler screams.", "Say \"You're mad. Tower fell.\""],
        recent: ["Big feelings need few words.", "Bedtime can be calm."], recentTags: ["#toddlertantrums"], format: "named_method", keyPhrase: "You're mad. Tower fell.",
      }),
      bare: reelCaptionPrompt({ title: "x", lines: ["One line."] }),
    }).toMatchSnapshot();
  });

  it("topic bank, topic picks and topic ideas prompt", () => {
    const rng = seededRandom(42);
    const bank = pickBankIdeas(["say_this", "named_method"], ["five-word-rule"], ["The Whisper Trick: go quieter to get your toddler's attention"], 5, rng);
    expect({
      REEL_TOPICS,
      picks: REEL_FORMATS.map((f) => pickTopic(f, ["five-word-rule", "tantrum-phrases"], seededRandom(3)).id),
      byId: topicById("honey-for-babies"),
      spread: formatSpread(["lola_science"], 5),
      bank: bank.map((t) => t.id),
      hooks: REEL_TOPICS.map((t) => templateHook(t)),
      IDEAS_SYSTEM,
      ideasPrompt: ideasPrompt({ bank, fresh: 3, freshFormats: ["say_this", "problem_fix"], recent: ["Bedtime stalling"], exclude: ["Old topic"] }),
      built: buildIdeas(null, { bank, avoid: [] }),
      reuses: [reusesBankMethod("The 2-Choice Rule for bedtime"), reusesBankMethod("A brand new idea")],
    }).toMatchSnapshot();
  });

  it("name / theme / letter suggestion prompts", () => {
    const existing = Array.from({ length: 700 }, (_, i) => `Name${i}`);
    expect({
      NAMES_SYSTEM, THEMES_SYSTEM, LETTER_SYSTEM,
      names: namesPrompt({ gender: "girl", style: "two-word", count: 10, existing: ["Isla Marigold", "Arlo Zenith"] }),
      namesVibe: namesPrompt({ gender: "boy", style: "single", count: 7, vibe: "  nature   names ", existing: [] }),
      namesSampled: namesPrompt({ gender: "boy", style: "single", count: 7, existing }, seededRandom(9)),
      themes: themesPrompt({ gender: "boy", count: 4, existing: [{ title: "Boho Pampas", props: "wicker basket,  pampas grass" }] }),
      themesVibe: themesPrompt({ gender: "girl", count: 2, vibe: "spring", existing: [] }),
      letterTwo: letterPrompt({ gender: "girl", style: "two-word", letter: "K", count: 6, existing: ["Kaia Wren"] }),
      letterOne: letterPrompt({ gender: "boy", style: "single", letter: "Z", count: 5, existing: [] }),
    }).toMatchSnapshot();
  });

  it("hashtag defaults and selection", () => {
    const history = [["#uniquenames", "#babynames"], ["#uniquenames", "#babyboynames", "#momlife"]];
    const defaults = tagSettings({});
    expect({
      HASHTAGS_ALWAYS_DEFAULT, HASHTAG_POOL_DEFAULT, defaults,
      legacy: legacyPool("#fyp #parenting #uniquenames #babynames #newmom"),
      fromOld: tagSettings({ hashtags: "#parenting #uniquenames #fyp" }),
      post: GENDERS.map((gender) => pickPostTags({ always: defaults.always, themeTags: ["#autumnbaby", "#babynames"], pool: defaults.pool, gender, history })),
      postTemplate: GENDERS.map((gender) => pickPostTags({ always: defaults.always, themeTags: [], pool: defaults.pool, gender, history, poolCount: 2 })),
      reel: pickReelTags({ always: defaults.always, topicTags: ["#toddlertantrums", "#gentleparenting", "#momtips"], pool: defaults.pool, history }),
      reelNoTopic: pickReelTags({ always: defaults.always, topicTags: [], pool: defaults.pool, history }),
    }).toMatchSnapshot();
  });

  it("closing card messages and their rotation", () => {
    const list = ctaMessagesOf({ cta_messages: null });
    const recent: string[] = [];
    const rotation: string[] = [];
    for (let i = 0; i < 12; i++) {
      const m = pickCtaMessage(list, recent, i % 2 ? "girl" : "boy");
      rotation.push(m);
      recent.unshift(m);
    }
    expect({ CTA_MESSAGES_DEFAULT, list, empty: ctaMessagesOf({ cta_messages: "  \n " }), rotation, emptyTemplates: pickCtaMessage([], [], "girl") }).toMatchSnapshot();
  });

  it("voices and the style previews", () => {
    expect({
      HOUSE_VOICES, VOICE_DEFAULT, REF_TEXT, fallback: houseDefault("puck"),
      crayonPreview: guidePreviewPrompt("crayon"), redPreview: guidePreviewPrompt("redthread"),
    }).toMatchSnapshot();
  });
});
