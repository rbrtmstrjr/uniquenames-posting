import "server-only";
import { FORMAT_SPECS, isReelFormat, REEL_FORMATS, type ReelFormat } from "@/lib/reels/formats";
import { isHealthTopic, REEL_TOPICS, type ReelTopic } from "@/lib/reels/topics";
import {
  BANK_IDEAS, FRESH_IDEAS, IDEA_COUNT, IDEA_HOOK_MAX_WORDS, IDEA_TOPIC_MAX, IDEA_WHY_MAX_WORDS, ideaKey, pickBankIdeas, TEMPLATE_WHY,
  templateHook, formatSpread, type TopicIdea,
} from "@/lib/reels/topic-ideas";
import type { GeminiSchema } from "./gemini";
import { plainWordsProblem } from "./plain-words";
import { aiJson } from "./provider";
import { CTA_RE, GREETING_RE, MECHANISM_RE, narratorFirstPerson, OUTRO_RE, REASSURE_RE } from "./reel-script";

/** The owner waits on this with a spinner: Haiku (low effort) answers in a few seconds. */
export const IDEAS_TIMEOUT_MS = 30_000;
/** Fresh ideas asked for: one more than shown, so a rule-breaker can be dropped. */
export const FRESH_ASK = FRESH_IDEAS + 1;
/** Bank ideas the AI writes hooks for: the 3 shown + backups that stand in for a dropped fresh idea. */
export const BANK_ASK = BANK_IDEAS + FRESH_IDEAS;
/** Recent titles / topics the prompt carries. */
export const AVOID_CAP = 40;

const oneLine = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const words = (s: string) => s.split(" ").filter(Boolean).length;
/** Medicines, doses and diagnoses: a fresh health idea stays general comfort-and-care (the bank holds the vetted ones). */
const MEDICAL_RE = /\b(?:dose|dosage|doses|mg|ml|paracetamol|ibuprofen|acetaminophen|tylenol|motrin|calpol|aspirin|antibiotic\w*|medicine\w*|medication\w*|drug\w*|vaccin\w*|syrup|diagnos\w*|autism|adhd|seizure\w*|allerg\w*|eczema|asthma)\b/i;
/** A ban the script also enforces: never fear absolutes or "doctors won't tell you". */
const HYPE_RE = /\b(?:forever|proven|cures?|doctors won't tell you|secret (?:trick|doctors))\b/i;

/** What breaks the line-1 rules in a suggested hook, or null. */
export function hookProblem(hook: string): string | null {
  if (words(hook) < 3) return "the hook is too short";
  if (words(hook) > IDEA_HOOK_MAX_WORDS) return `the hook is longer than ${IDEA_HOOK_MAX_WORDS} words`;
  if (GREETING_RE.test(hook)) return "the hook is a greeting";
  if (CTA_RE.test(hook) || OUTRO_RE.test(hook)) return "the hook is a call to action or an outro";
  if (REASSURE_RE.test(hook)) return "the hook reassures instead of naming the problem";
  if (MECHANISM_RE.test(hook) || HYPE_RE.test(hook)) return "the hook makes a body or hype claim";
  const me = narratorFirstPerson(hook, true);
  if (me) return `the hook speaks as I / we ("${me}")`;
  return plainWordsProblem(hook);
}

/** What breaks the rules in a "why" line, or null. */
export function whyProblem(why: string): string | null {
  if (words(why) < 3) return "the why is too short";
  if (words(why) > IDEA_WHY_MAX_WORDS) return `the why is longer than ${IDEA_WHY_MAX_WORDS} words`;
  if (CTA_RE.test(why) || HYPE_RE.test(why)) return "the why is a call to action or hype";
  return plainWordsProblem(why);
}

/** What breaks the rules in a fresh topic, or null. */
export function topicProblem(topic: string, health: boolean): string | null {
  if (!topic) return "no topic";
  if (topic.length > IDEA_TOPIC_MAX) return `the topic is longer than ${IDEA_TOPIC_MAX} characters`;
  if (GREETING_RE.test(topic) || CTA_RE.test(topic) || HYPE_RE.test(topic)) return "the topic is a greeting, call to action or hype";
  if (/\b(?:teen\w*|tween\w*|teenager\w*|1[0-9]-year-old)\b/i.test(topic)) return "the topic is not about the early years";
  if (health && MEDICAL_RE.test(topic)) return "a health topic names a medicine, dose or diagnosis";
  return plainWordsProblem(topic);
}

/** Content words of a topic (for "is this the same idea?"). */
const STOP = new Set(["the", "and", "for", "you", "your", "with", "what", "why", "how", "that", "this", "when", "from", "are", "not", "but", "can", "its", "it's", "his", "her", "them", "they", "one", "who", "say", "says", "said", "instead", "toddler", "toddlers", "baby", "babies", "child", "children", "kid", "kids", "mom", "moms", "3", "5"]);
const contentWords = (s: string) => new Set(ideaKey(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (w.length > 4 ? w.replace(/s$/, "") : w)));
/** The same idea: the same words, or most (3 in 4) of the shorter one's content words (at least 2) in the other. */
export function sameIdea(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (ideaKey(a) === ideaKey(b)) return true;
  const x = contentWords(a), y = contentWords(b);
  const small = x.size <= y.size ? x : y, big = small === x ? y : x;
  if (small.size < 2) return false;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared >= 2 && shared / small.size >= 0.75;
}

const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", fifteen: "15" };
/** The named methods in a topic ("the 2-Choice Rule" = "the Two-Choice Rule" → "2 choice rule"). */
export function methodNames(s: string): string[] {
  const key = ideaKey(s).split(" ").map((w) => NUMBER_WORDS[w] ?? w).join(" ");
  return [...key.matchAll(/(?:^| )((?:[\p{L}\d]+ ){1,2}(?:rule|method|trick|game|jar|repair))(?= |$)/gu)].map((m) => m[1].replace(/^(?:the|a|try) /, ""));
}
const BANK_METHODS = new Set(REEL_TOPICS.flatMap((t) => methodNames(t.topic)));
/** A fresh topic reusing a bank method's name. */
export const reusesBankMethod = (topic: string) => methodNames(topic).some((m) => BANK_METHODS.has(m));

/** One plain line per format, for the AI to place a fresh idea. */
const FORMAT_HINT: Record<ReelFormat, string> = {
  named_method: "a catchy named method with 3-4 steps (\"The 2-Choice Rule\")",
  say_this: "phrases to stop saying and what to say instead",
  lola_science: "an old wives' tale or old rule known in many countries, and what doctors or experts say now",
  scene_lesson: "a real everyday moment, what is really going on, and the words that help",
  problem_fix: "one specific problem, the child's-eye reason, and simple fixes",
};

export const IDEAS_SYSTEM = [
  "You suggest topic ideas for short narrated reels on a Facebook page for moms of babies and young kids, around the world (most are in the Philippines, others in the US, Africa, Australia and beyond). Each reel teaches ONE useful thing a busy mom can use tonight, with the exact words to say, spoken straight to her as 'you'.",
  "SIMPLE GLOBAL ENGLISH: everyday words, about a 5th-6th grade level. Never a Filipino or Tagalog word or Taglish (no anak, lola, lolo, nanay, tatay, kuya, bunso, po, opo, salamat, naman, talaga, kasi, lang, merienda, sala, jeepney), nothing tied to one country (no holidays, store names, money amounts or local customs). Grandparents are Grandma and Grandpa.",
  "NO JARGON: never name a technique, study, therapy or brain part (no co-regulation, self-regulation, executive function, amygdala, prefrontal cortex, cortisol, dopamine, attachment theory, nervous system, serve and return, affect labeling, Harvard). Your own catchy tip names ('the Two-Choice Rule') are fine.",
  "AGES: newborns, babies, toddlers and children up to 5 only. Warm and practical, never fear, guilt or shame. No emojis, no hashtags.",
].join("\n");

export interface IdeasPromptInput {
  /** The bank ideas to write hooks for (shown + backups). */
  bank: ReelTopic[];
  /** Fresh ideas wanted, and the formats to prefer for them. */
  fresh: number; freshFormats: ReelFormat[];
  /** Recent reel titles and topics (newest first) and the topics already shown to the owner. */
  recent: string[]; exclude: string[];
}

export function ideasPrompt({ bank, fresh, freshFormats, recent, exclude }: IdeasPromptInput): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${oneLine(x)}`).join("\n") : "(none)");
  const ids = new Set(bank.map((t) => t.id));
  const bankList = REEL_TOPICS.filter((t) => !ids.has(t.id)).map((t) => t.topic);
  return [
    "PART 1 — HOOKS FOR THESE TOPICS: keep each topic and format exactly as given; write its hook and its why.",
    ...bank.map((t) => `- id: ${t.id} | format: ${FORMAT_SPECS[t.format].label} | topic: ${t.topic}`),
    "",
    `PART 2 — ${fresh} FRESH IDEAS of your own, clearly different from every topic and title in this message (Part 1, the bank list, the already-made and already-shown lists), in these formats, one each, in this order: ${Array.from({ length: fresh }, (_, i) => freshFormats[i % Math.max(1, freshFormats.length)] ?? REEL_FORMATS[i % REEL_FORMATS.length]).join(", ")}. The formats:`,
    ...REEL_FORMATS.map((f) => `- ${f} (${FORMAT_SPECS[f].label}): ${FORMAT_HINT[f]}`),
    `Each fresh topic is specific (a concrete problem, method, old saying or exact phrase, never a vague one), at most ${IDEA_TOPIC_MAX} characters, in plain words, written like the topics in Part 1. Health ideas (fever, illness, sleep, feeding, how a baby grows) are allowed: set "health" to true and keep them to general comfort and care (no medicine names, doses or diagnoses). Otherwise "health" is false.`,
    "",
    `THE HOOK (every idea): the reel's first spoken line, heard in the first half-second. At most ${IDEA_HOOK_MAX_WORDS} words (aim for 6-10). It talks to the mom ('you', 'your toddler', or a direct 'Stop saying…' / 'Try…'), names the SPECIFIC problem, method, old saying or exact phrase, and promises something concrete. Never a greeting or intro ('Hey moms', 'Today…'), never a call to action (follow, like, comment, share, save), never 'don't worry' or 'don't feel bad', never I / we / my (words a child or the mom says go in double quotes: '"Mommy, I need to poop!" Right as you sit down?'), never 'forever', 'proven' or a fear line. COUNT the words: 13 is too many. Examples of the style: 'Stop saying "calm down". Try the 5-Word Rule instead.' — 'Your toddler hits when he's mad? He's out of words.' — 'Grandma said wet hair gives you a cold. Doctors disagree.'`,
    `THE WHY: at most ${IDEA_WHY_MAX_WORDS} words: what she learns or can do after watching, in plain words.`,
    "",
    "ALREADY MADE — do not repeat or rephrase these:",
    list(recent),
    "",
    "ALREADY IN THE TOPIC BANK — fresh ideas must not repeat or rephrase these (or reuse their method names):",
    list(bankList),
    "",
    "ALREADY SHOWN TO THE OWNER — do not repeat or rephrase these:",
    list(exclude),
    "",
    `Return JSON: {"bank": [{"id", "hook", "why"}] (one per Part 1 topic), "fresh": [{"topic", "format", "hook", "why", "health"}] (${fresh} ideas)}.`,
  ].join("\n");
}

export const IDEAS_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    bank: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "STRING" }, hook: { type: "STRING" }, why: { type: "STRING" } },
        required: ["id", "hook", "why"],
      },
    },
    fresh: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" }, format: { type: "STRING", enum: [...REEL_FORMATS] },
          hook: { type: "STRING" }, why: { type: "STRING" }, health: { type: "BOOLEAN" },
        },
        required: ["topic", "format", "hook", "why", "health"],
      },
    },
  },
  required: ["bank", "fresh"],
};

type Raw = Record<string, unknown>;
interface IdeasRaw { bank: Raw[]; fresh: Raw[] }
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object" && !Array.isArray(x)) : []);
export const parseIdeas = (raw: unknown): IdeasRaw | null =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? { bank: rows((raw as Raw).bank), fresh: rows((raw as Raw).fresh) } : null;
/** One line without wrapping quotes (the hook keeps its end mark; the why / topic drop a final period). */
const clean = (v: unknown) => {
  const s = oneLine(v);
  return (s.match(/^["“]([^"“”]*)["”]$/)?.[1] ?? s).trim();
};
const noPeriod = (s: string) => s.replace(/\.+$/, "").trim();

export interface BuildInput {
  /** The bank candidates in order (the first BANK_IDEAS are shown; the rest stand in for missing fresh ideas). */
  bank: ReelTopic[];
  /** Topics / titles a fresh idea must not repeat (recent reels + already shown). */
  avoid: string[];
  /** Collects why each AI line was dropped (logs / the smoke run). */
  notes?: string[];
}

/**
 * The batch from the AI's answer (null = the AI failed): the bank ideas with the AI's hook and why when they pass
 * the rules (else the plain template), and up to FRESH_IDEAS fresh ideas that pass every check (plain words, hook
 * rules, ≤ 90 characters, a real format, not a repeat of a recent / shown / bank topic); bank backups fill the rest.
 * Order: bank, fresh, bank, fresh, bank, then any backups.
 */
export function buildIdeas(raw: IdeasRaw | null, { bank, avoid, notes }: BuildInput): TopicIdea[] {
  const note = (what: string, why: string | null) => { if (why) notes?.push(`${what}: ${why}`); return !!why; };
  const byId = new Map((raw?.bank ?? []).map((r) => [oneLine(r.id), r]));
  const bankIdea = (t: ReelTopic): TopicIdea => {
    const r = byId.get(t.id);
    const hook = clean(r?.hook);
    const why = noPeriod(clean(r?.why));
    const badHook = note(`${t.id} hook "${hook}"`, r ? hookProblem(hook) : "missing");
    const badWhy = note(`${t.id} why "${why}"`, r ? whyProblem(why) : null);
    return {
      topic: t.topic, format: t.format, hook: badHook ? templateHook(t) : hook,
      why: badWhy || !why ? noPeriod(TEMPLATE_WHY[t.format]) : why, source: "bank", topicId: t.id, health: t.health,
    };
  };
  const fresh: TopicIdea[] = [];
  for (const r of raw?.fresh ?? []) {
    if (fresh.length >= FRESH_IDEAS) break;
    const topic = noPeriod(clean(r.topic));
    const format = oneLine(r.format);
    const hook = clean(r.hook);
    const why = noPeriod(clean(r.why));
    const health = r.health === true || isHealthTopic(topic);
    const what = `fresh "${topic}"`;
    if (note(what, isReelFormat(format) ? null : `unknown format ${format}`) || note(what, topicProblem(topic, health))) continue;
    if (note(`${what} hook "${hook}"`, hookProblem(hook)) || note(`${what} why "${why}"`, whyProblem(why))) continue;
    if (note(what, health && (MEDICAL_RE.test(hook) || MEDICAL_RE.test(why)) ? "a health idea names a medicine" : null)) continue;
    const repeats = reusesBankMethod(topic) || [...avoid, ...REEL_TOPICS.map((t) => t.topic), ...fresh.map((f) => f.topic)].some((x) => sameIdea(topic, x));
    if (note(what, repeats ? "repeats a bank, recent or shown topic" : null)) continue;
    fresh.push({ topic, format: format as ReelFormat, hook, why, source: "fresh", health });
  }
  const shown = bank.slice(0, BANK_IDEAS + FRESH_IDEAS - fresh.length).map(bankIdea);
  const out: TopicIdea[] = [];
  for (let i = 0; out.length < shown.length + fresh.length; i++) {
    if (shown[i]) out.push(shown[i]);
    if (fresh[i]) out.push(fresh[i]);
  }
  // the backups (when a fresh idea was dropped) were interleaved already; keep the batch at IDEA_COUNT at most
  return out.slice(0, IDEA_COUNT);
}

export interface SuggestTopicsInput {
  /** The latest reels (newest first): formats, bank ids, and titles + topics to avoid. */
  recentFormats: (string | null)[]; recentIds: string[]; recentTitles: string[];
  /** Topics already shown to the owner ("More ideas"). */
  exclude: string[];
  rng?: () => number;
}
export interface SuggestTopicsResult {
  ideas: TopicIdea[];
  /** Set when the AI failed and the batch is bank-only. */
  aiError?: string;
  /** Why AI lines were dropped (a template or a bank backup stood in). */
  dropped: string[];
}

/** 5 topic ideas: one cheap AI call (task "small") for every hook; bank-only with template hooks if it fails. Never throws. */
export async function suggestTopicIdeas(input: SuggestTopicsInput): Promise<SuggestTopicsResult> {
  const bank = pickBankIdeas(input.recentFormats, input.recentIds, input.exclude, BANK_ASK, input.rng);
  const shownFormats = new Set(bank.slice(0, BANK_IDEAS).map((t) => t.format));
  const spread = formatSpread(input.recentFormats, REEL_FORMATS.length);
  const freshFormats = [...spread.filter((f) => !shownFormats.has(f)), ...spread.filter((f) => shownFormats.has(f))].slice(0, FRESH_ASK);
  const recent = input.recentTitles.map(oneLine).filter(Boolean).slice(0, AVOID_CAP);
  const avoid = [...recent, ...input.exclude];
  let aiError: string | undefined;
  let raw: IdeasRaw | null = null;
  try {
    const r = await aiJson<IdeasRaw>({
      task: "small", system: IDEAS_SYSTEM,
      prompt: ideasPrompt({ bank, fresh: FRESH_ASK, freshFormats, recent, exclude: input.exclude }),
      schema: IDEAS_SCHEMA, temperature: 1, timeoutMs: IDEAS_TIMEOUT_MS, parse: parseIdeas,
    });
    if (r?.ok) raw = r.data;
    else aiError = r?.error ?? "The AI did not answer.";
  } catch (e) {
    aiError = e instanceof Error ? e.message.slice(0, 120) : "The AI did not answer.";
  }
  const dropped: string[] = [];
  const ideas = buildIdeas(raw, { bank, avoid, notes: raw ? dropped : undefined });
  return { ideas, dropped, ...(aiError ? { aiError } : {}) };
}
