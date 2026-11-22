import "server-only";
import type { CardRow } from "@/lib/db/types";
import type { GeminiSchema } from "@/lib/ai/gemini";
import { judgeJson, type JudgeResult } from "./claude-judge";
import { PHOTO_PROBLEMS, parseLookAlike, parsePhotoVerdict, type PhotoVerdict } from "./photo-problems";

export const PHOTO_JUDGE_SYSTEM = [
  "You check AI-generated baby photo cards before they are posted on a Facebook page for Filipino parents.",
  "Each card is one square photo with a baby name and its meaning stamped on it; the closing card has a short follow message instead, and the front card (the album's first picture) has the post's title.",
  "Some cards are still lifes on purpose: props and clothes with no baby. That is fine.",
  "A card fails for any of these (use these problem ids):",
  "- hands: extra, missing, fused or twisted fingers, or a deformed hand",
  "- feet: extra, missing or fused toes, or a deformed foot",
  "- face: a warped, melted or uneven face, odd eyes or teeth",
  "- soles: the baby lies on the floor with the soles of the feet toward the camera (it looks lifeless)",
  "- skin: anything beyond bare arms, legs and feet: no bare chest, bare bottom or diaper-only photo",
  "- split: a split, collage, grid or picture-in-picture frame instead of one photo",
  "- text: letters, words or logos inside the photo itself (the stamped name, meaning, title, message and handle are fine)",
  "- name_on_face: the stamped text covers the baby's face",
  "- extra_person: an extra baby, a second head, or stray arms, legs or hands",
  "- other: anything else a parent would find wrong or creepy",
  "Be strict about hands, feet and skin: when in doubt, fail it. Do not fail a card for its style, colors or props.",
].join("\n");

const CARD_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    pass: { type: "BOOLEAN" },
    problems: { type: "ARRAY", items: { type: "STRING", enum: [...PHOTO_PROBLEMS] } },
    note: { type: "STRING", description: "One short sentence: what is wrong (empty when it passes)" },
  },
  required: ["pass", "problems", "note"],
};

type Stamped = Pick<CardRow, "kind" | "name"> & Partial<Pick<CardRow, "meaning">>;

/** What is stamped on a card, in the judge's words. */
export function stampedText(card: Stamped): string {
  if (card.kind === "cta") return "This is the closing card: its stamped text is a follow message.";
  if (card.kind === "cover") return `This is the album's front card: its stamped text is the post's title ("${[card.name, card.meaning].filter(Boolean).join(" / ")}").`;
  return `The stamped name is ${card.name}.`;
}

/** One card, as its stamped image (a signed URL). */
export function judgeCard(card: Stamped, url: string): Promise<JudgeResult<PhotoVerdict>> {
  const what = stampedText(card);
  return judgeJson({
    system: PHOTO_JUDGE_SYSTEM, schema: CARD_SCHEMA, parse: parsePhotoVerdict, timeoutMs: 90_000,
    content: [{ type: "text", text: `${what} Check this card.` }, { type: "image", source: { type: "url", url } }],
  });
}

export const LOOKALIKE_SYSTEM = [
  "You see all the cards of one Facebook album of baby name cards, numbered in posting order.",
  "Albums where photos repeat do badly. Name the cards that look too alike: nearly the same pose, angle, framing and props as an EARLIER card.",
  "A different name, color or a small change does not make two cards different. Still lifes count too.",
  "Return the number of the later card of each look-alike pair (never card 1), at most 3. Return an empty list when every card looks different enough.",
  "The front card (marked as such) shows the post's title instead of a name; it counts like any other card.",
].join("\n");

const LOOKALIKE_SCHEMA: GeminiSchema = { type: "OBJECT", properties: { remake: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["remake"] };

/** All the passed cards of one post together; the numbers (1-based) of cards to remake. */
export function judgeLookAlike(cards: { card: Pick<CardRow, "kind" | "name">; url: string }[]): Promise<JudgeResult<number[]>> {
  const content = cards.flatMap(({ card, url }, k) => [
    { type: "text" as const, text: card.kind === "cover" ? `Card ${k + 1} (the front card):` : `Card ${k + 1}:` },
    { type: "image" as const, source: { type: "url" as const, url } },
  ]);
  return judgeJson({ system: LOOKALIKE_SYSTEM, schema: LOOKALIKE_SCHEMA, parse: (raw) => parseLookAlike(raw, cards.length), timeoutMs: 150_000, content });
}
