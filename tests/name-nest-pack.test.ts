import { statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packById, type NichePack } from "@/packs";
import { settingsSeed } from "@/packs/seed";
import { brandCss } from "@/packs/theme";
import { validateTagList } from "@/lib/captions/hashtags";
import { parseCtaMessages, validateCtaMessages } from "@/lib/cta/messages";
import { CAPTION_STYLES } from "@/lib/captions/styles";
import { REEL_FORMATS } from "@/lib/reels/formats";
import catalog from "@/lib/fonts/catalog.json";

// Name Nest (@namenest): a US-only parenting page (spec 2026-10-10-niche-packs-name-nest-design + the owner's
// "US page launch plan"). Every text the pack feeds an AI prompt speaks to American families only.

const NN = packById("name-nest");
const UN = packById("unique-names");
const root = join(__dirname, "..");

/** Every string of the pack that reaches an AI prompt. */
function promptTexts(p: NichePack): Record<string, string> {
  const out: Record<string, string> = {
    postSystem: p.captions.postSystem(240), reelSystem: p.captions.reelSystem(300),
    namesSystem: p.suggest.namesSystem({ min: 2, max: 6 }), namesDefaultVibe: p.suggest.namesDefaultVibe,
    themesSystem: p.suggest.themesSystem, themesDefaultVibe: p.suggest.themesDefaultVibe, letterSystem: p.suggest.letterSystem,
    scriptSystem: p.reels.scriptSystem, autoTopic: p.reels.autoTopic, castPeople: p.reels.castPeople, castDolls: p.reels.castDolls,
    crayonStory: p.reels.crayonStory, redThreadStory: p.reels.redThreadStory, ideasSystem: p.reels.ideasSystem,
    voiceRefText: p.reels.voiceRefText, threadDistance: p.reels.threadDistance ?? "",
    looks: [...p.cards.looks, ...p.cards.childLooks].join("\n"),
  };
  for (const s of CAPTION_STYLES) { out[`style:${s}:boy`] = p.captions.styleGuide[s]("boy"); out[`style:${s}:girl`] = p.captions.styleGuide[s]("girl"); }
  for (const f of REEL_FORMATS) out[`hint:${f}`] = p.reels.formatHints[f];
  for (const t of p.reels.topics) out[`topic:${t.id}`] = [t.topic, ...(t.facts ?? []), t.safety ?? "", t.anchor ?? ""].join("\n");
  return out;
}

/** Global / Philippine audience framing (bans like "never mention the Philippines" are fine: they name it to forbid it). */
const NON_US = /around the world|global (?:audience|english)|simple global|anyone understands|most (?:are )?in the philippines|filipino (?:mom|mother|audience)|working abroad|overseas|\bOFW\b|others in the US|Africa|Australia/i;

describe("name-nest: US-only prompts", () => {
  it("no global or Philippine audience framing anywhere it feeds an AI", () => {
    for (const [k, v] of Object.entries(promptTexts(NN))) expect([k, v.match(NON_US)?.[0] ?? null]).toEqual([k, null]);
  });

  it("speaks to American families, in American English, with the Tagalog and jargon bans kept", () => {
    const t = promptTexts(NN);
    for (const k of ["postSystem", "reelSystem", "scriptSystem", "ideasSystem"]) {
      expect([k, /United States|American/.test(t[k])]).toEqual([k, true]);
      expect([k, /Tagalog/.test(t[k])]).toEqual([k, true]);
    }
    expect(t.scriptSystem).toMatch(/US spelling/);
    expect(t.scriptSystem).toMatch(/°F/);
    expect(t.scriptSystem).toMatch(/traveling for work or deployed/);
    expect(t.scriptSystem).toMatch(/affect labeling/); // the jargon ban
    expect(t.postSystem).toMatch(/@namenest/);
    expect(t.postSystem).not.toMatch(/@unique_names/);
  });

  it("the post caption may use a name's origin and US rank, only as given", () => {
    expect(NN.captions.postSystem(240)).toMatch(/origin, a rank or a fact/);
    expect(NN.captions.styleGuide.fact("girl")).toMatch(/US rank/);
  });
});

describe("name-nest: reel topic bank", () => {
  const topics = NN.reels.topics;
  it("unique ids; the overseas-parent idea is dropped; the US topics are in", () => {
    expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length);
    expect(topics.find((t) => t.id === "parent-abroad")).toBeUndefined();
    const us = ["daycare-dropoff", "car-seat-basics", "puffy-coat-car-seat", "look-before-you-lock", "halloween-candy", "thanksgiving-toddler",
      "back-to-school-mornings", "pool-water-watcher", "baby-sun-shade", "fourth-of-july-sparklers", "kindergarten-first-day", "holiday-gifts",
      "daylight-saving-bedtime", "checkout-meltdown", "snow-day"];
    for (const id of us) expect([id, !!topics.find((t) => t.id === id)]).toEqual([id, true]);
    expect(topics.length).toBeGreaterThanOrEqual(UN.reels.topics.length + 14);
  });

  it("every health topic carries vetted facts and a safety line; US facts use °F / degrees Fahrenheit and feet", () => {
    for (const t of topics.filter((x) => x.health)) {
      expect([t.id, (t.facts ?? []).length >= 3 && (t.facts ?? []).length <= 5, !!t.safety]).toEqual([t.id, true, true]);
      // the engine's rule (tests/reel-formats): a short safety line that names the doctor
      expect([t.id, /\b(doctor|pediatrician)\b/i.test(t.safety!), t.safety!.split(/\s+/).length <= 15]).toEqual([t.id, true, true]);
      for (const f of t.facts ?? []) expect([t.id, /°C|celsius|metres?|meters?|\bkm\b/i.test(f)]).toEqual([t.id, false]);
    }
    expect(topics.find((t) => t.id === "look-before-you-lock")!.facts!.join(" ")).toMatch(/20 degrees Fahrenheit/);
  });

  it("each topic has one of the five formats and fits the topic box", () => {
    for (const t of topics) {
      expect(REEL_FORMATS).toContain(t.format);
      expect([t.id, t.topic.length <= 120]).toEqual([t.id, true]);
    }
  });
});

describe("name-nest: cards and looks", () => {
  it("ten varied American looks, baby and child forms paired by index", () => {
    expect(NN.cards.looks).toHaveLength(10);
    expect(NN.cards.childLooks).toHaveLength(10);
    const all = NN.cards.looks.join(" | ");
    for (const w of ["light-blond", "deep brown skin", "olive", "golden", "medium-brown", "curls", "coils"]) expect(all).toContain(w);
    expect(all).not.toMatch(/rosy|filipin/i);
    expect(NN.cards.looks.some((l) => UN.cards.looks.includes(l))).toBe(false);
  });

  it("photoshoot themes: American nursery styles with one strawberry-red accent prop", () => {
    const s = NN.suggest.themesSystem;
    for (const w of ["modern farmhouse", "boho neutral", "Scandinavian minimal", "classic Americana", "cozy cabin", "spring garden", "strawberry-red"]) expect(s).toContain(w);
    expect(s).toContain("smooth seamless <color> studio backdrop");
  });
});

describe("name-nest: brand", () => {
  const b = NN.brand;
  it("name, handle, hint and assets", () => {
    expect(b).toMatchObject({ name: "Name Nest", handle: "@namenest", pcFolder: "Name Nest", zipPrefix: "name-nest" });
    expect(b.postingTimeHint).toBe("Best times for US moms: 9–10 pm, 12–2 am, 7–9 am PH time (+1 h after Nov 1)");
    for (const p of [b.assets.icon, b.assets.logo!, ...Object.values(b.assets.login), "/packs/name-nest/logo.svg"]) {
      expect([p, statSync(join(root, "public", p)).isFile()]).toEqual([p, true]);
    }
  });

  it("strawberry red & cream website theme, light and dark", () => {
    expect(b.colors.light).toMatchObject({ accent: "#A8323A", ink: "#2B1E1E", line: "#E8D6D0" });
    expect(Object.keys(b.colors.light).sort()).toEqual(Object.keys(UN.brand.colors.light).sort());
    expect(Object.keys(b.colors.dark).sort()).toEqual(Object.keys(UN.brand.colors.dark).sort());
    expect(brandCss(b.colors)).toContain("--accent:#A8323A");
    expect(brandCss(b.colors)).toContain("html.dark{--bg:#120C0C");
  });

  it("never reuses Unique Names' identity", () => {
    expect(b.handle).not.toBe(UN.brand.handle);
    expect(NN.captionTemplate).not.toBe(UN.captionTemplate);
    const un = new Set(parseCtaMessages(UN.ctaMessages).map((m) => m.toLowerCase()));
    expect(parseCtaMessages(NN.ctaMessages).filter((m) => un.has(m.toLowerCase()))).toEqual([]);
    expect(NN.hashtags.pool).not.toBe(UN.hashtags.pool);
    expect(NN.cardText.titleFont).not.toBe(UN.cardText.titleFont);
    expect(NN.cardText.meaningFont).not.toBe(UN.cardText.meaningFont);
  });
});

describe("name-nest: settings seed", () => {
  const seed = settingsSeed(NN);
  it("handle, tags, closing cards, voice, fonts and the card layout", () => {
    expect(seed).toMatchObject({ handle: "@namenest", hashtags_always: "#namenest", card_layout: "name-nest", title_font: "dmserif", meaning_font: "nunito", mark_font: "nunito" });
    const ids = catalog.fonts.map((f) => f.id);
    for (const f of [seed.title_font, seed.meaning_font, seed.mark_font]) expect(ids).toContain(f);
    expect(validateTagList(seed.hashtag_pool, "pool", 3, 30)).toBeNull();
    expect(seed.hashtag_pool.split(" ")).toHaveLength(12);
    expect(validateTagList(seed.hashtags_always, "always", 1, 2)).toBeNull();
    expect(NN.voices.house.map((v) => v.id)).toContain(seed.reel_voice_id);
  });

  it("eight valid closing-card messages, none of them bait", () => {
    expect(validateCtaMessages(seed.cta_messages)).toBeNull();
    const list = parseCtaMessages(seed.cta_messages);
    expect(list).toHaveLength(8);
    for (const m of list) expect([m, /\b(?:like|share|comment|tag)\b/i.test(m)]).toEqual([m, false]);
  });
});

describe("NICHE=name-nest: the engine reads the Name Nest pack", () => {
  const saved = process.env.NICHE;
  afterEach(() => {
    if (saved === undefined) delete process.env.NICHE;
    else process.env.NICHE = saved;
    vi.resetModules();
  });

  it("captions, scripts, ideas, card prompts and the browser brand", async () => {
    process.env.NICHE = "name-nest";
    vi.resetModules();
    const { CAPTION_SYSTEM } = await import("@/lib/ai/caption");
    const { REEL_SCRIPT_SYSTEM, reelScriptPrompt } = await import("@/lib/ai/reel-script");
    const { IDEAS_SYSTEM } = await import("@/lib/ai/reel-ideas");
    const { REEL_TOPICS } = await import("@/lib/reels/topics");
    const { LOOKS } = await import("@/lib/planner/prompt");
    const { brand } = await import("@/packs/shared");
    const { HASHTAGS_ALWAYS_DEFAULT } = await import("@/lib/captions/hashtags");
    expect(CAPTION_SYSTEM).toContain("@namenest");
    expect(REEL_SCRIPT_SYSTEM).toContain("United States");
    expect(IDEAS_SYSTEM).toContain("American");
    expect(REEL_TOPICS.find((t) => t.id === "halloween-candy")).toBeTruthy();
    expect(LOOKS).toEqual(NN.cards.looks);
    expect(brand().name).toBe("Name Nest");
    expect(HASHTAGS_ALWAYS_DEFAULT).toBe("#namenest");
    const red = reelScriptPrompt({ topic: "first day of daycare", maxScenes: 12, alreadyMade: [], format: "scene_lesson", theme: { id: "redthread", faces: true } });
    expect(red.system + red.prompt).toContain("travels for work or is deployed");
    expect(red.system + red.prompt).not.toMatch(/abroad/i);
  });

  it("the default page still says a parent working abroad (Unique Names unchanged)", async () => {
    delete process.env.NICHE;
    vi.resetModules();
    const { reelScriptPrompt } = await import("@/lib/ai/reel-script");
    const red = reelScriptPrompt({ topic: "first day of daycare", maxScenes: 12, alreadyMade: [], format: "scene_lesson", theme: { id: "redthread", faces: true } });
    expect(red.prompt).toContain("stretched = distance (a parent working abroad, leaving for work, the first day apart)");
  });
});

describe("name-nest: its own caption checks", () => {
  it("a brand voice that says what the post is; the US abbreviation is fine", () => {
    const p = NN.captions.postProblem!;
    expect(p("Hazel and Olivia, two sweet baby girl names ranked #1 in the US.")).toBeNull();
    expect(p("I hope these baby boy names help.")).toMatch(/speaks as a person/);
    expect(p("Our favorite baby girl names this fall.")).toMatch(/speaks as a person/);
    expect(p("Picking a name takes real care.")).toMatch(/baby boy names or baby girl names/);
    expect(UN.captions.postProblem).toBeUndefined();
  });
});
