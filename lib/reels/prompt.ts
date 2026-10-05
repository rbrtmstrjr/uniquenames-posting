import { NO_TEXT } from "@/lib/planner/prompt";

// Z-Image runs at cfg 1 with no negative prompt: naming an unwanted thing summons it, so every
// line here only describes what should be in frame (NO_TEXT is the one proven exception).
// Never the word "camera"; framing is set with a lens line, as in the photoshoot planner.

/** The knitted-doll look, verbatim from the PC spike (round 3, docs/reference/reel-pc-spike.md). */
export const KNIT_STYLE =
  "Handmade amigurumi doll scene: every character is a soft crocheted wool doll, captured as premium handcrafted toy photography. " +
  "A tight, clearly visible crochet stitch grid covers the whole face and body, with fine fuzzy wool fibres on every surface; " +
  "a slightly oversized round head and soft chubby rounded limbs. Large glossy round black bead eyes with a small bright catchlight, " +
  "a tiny stitched nose bump, a simple curved embroidered smile, thin embroidered eyebrows, and hair made of loose chunky yarn strands, " +
  "each strand individually visible and softly fuzzy. The whole world is sewn and knitted by hand: the room is built from felt and linen, " +
  "with felt walls, a felt window frame, felt shelves, a felt floor, knitted blankets, stitched felt props and yarn details, " +
  "with small charming irregularities in the stitching. Soft diffused warm daylight from the front and a little to the side, " +
  "gentle low contrast, soft contact shadows, gentle highlights on the wool fibres and the bead eyes. " +
  "Palette: warm beige, cream, oatmeal and natural linen with mustard yellow, warm orange, rust and sage accents. " +
  "Soft rounded edges everywhere, cozy and tender.";

/** The script's two recurring dolls (stored as `reels.doll_cast`). */
export interface ReelCast { adult: string; child: string }

/** Z-Image keeps a medium/wide doll shot, so framing stays there; the hook just asks for more emotion. */
const LENS: Record<string, string> = {
  hook: "50mm lens at f/2.8, a medium shot full of strong emotion, the dolls sharp",
  close: "35mm lens at f/4, a warm medium-wide view, the dolls sharp",
};
const DEFAULT_LENS = "35mm lens at f/4, the whole cozy handmade setting in view, the dolls sharp";

const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[\s.;,]+$/, "");

/** One scene's image prompt: moment + lens first (order matters), then style, cast, composition, NO_TEXT. */
export function scenePrompt(cast: ReelCast, idea: string, beat: string): string {
  const moment = beat === "hook" ? "one striking, high-emotion moment" : "one tender moment";
  return [
    `A single full-bleed vertical 9:16 picture of ${moment}. Moment: ${clean(idea)}. Lens: ${LENS[beat] ?? DEFAULT_LENS}.`,
    `${KNIT_STYLE} Characters (the same two dolls in every picture): ${clean(cast.adult)}; ${clean(cast.child)}.`,
    "Composition: the handmade set fills the whole frame edge to edge; the upper third is a calm, softly lit plain fabric wall where captions can sit.",
    NO_TEXT,
  ].join("\n");
}
