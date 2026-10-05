import { NO_TEXT } from "@/lib/planner/prompt";

// Z-Image runs at cfg 1 with no negative prompt: naming an unwanted thing summons it, so every
// line here only describes what should be in frame (NO_TEXT is the one proven exception).
// Never the word "camera"; framing is set with a lens line, as in the photoshoot planner.

/** The knitted-doll look from the PC spike (round 3, docs/reference/reel-pc-spike.md); the set line widened beyond rooms. */
export const KNIT_STYLE =
  "Handmade amigurumi doll scene: every character is a soft crocheted wool doll, captured as premium handcrafted toy photography. " +
  "A tight, clearly visible crochet stitch grid covers the whole face and body, with fine fuzzy wool fibres on every surface; " +
  "a slightly oversized round head and soft chubby rounded limbs. Large glossy round black bead eyes with a small bright catchlight, " +
  "a tiny stitched nose bump, a simple curved embroidered smile, thin embroidered eyebrows, and hair made of loose chunky yarn strands, " +
  "each strand individually visible and softly fuzzy. The whole world is sewn and knitted by hand: every setting is built from felt and linen — " +
  "felt walls or felt sky, felt ground and floors, felt furniture and shelves, knitted blankets, stitched felt props and yarn details, " +
  "with small charming irregularities in the stitching. Soft diffused warm daylight from the front and a little to the side, " +
  "gentle low contrast, soft contact shadows, gentle highlights on the wool fibres and the bead eyes. " +
  "Palette: warm beige, cream, oatmeal and natural linen with mustard yellow, warm orange, rust and sage accents. " +
  "Soft rounded edges everywhere, cozy and tender.";

/** The script's two recurring dolls (stored as `reels.doll_cast`). */
export interface ReelCast { adult: string; child: string }

/** Z-Image keeps a medium/wide doll shot, so framing stays there; the opening hook just asks for more emotion. */
const HOOK_LENS = "50mm lens at f/2.8, a medium shot full of strong emotion, the dolls sharp";
const CLOSE_LENS = "35mm lens at f/4, a warm medium-wide view, the dolls sharp";
const DEFAULT_LENS = "35mm lens at f/4, the whole cozy handmade setting in view, the dolls sharp";

const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[\s.;,]+$/, "");

/**
 * One scene's image prompt: moment + lens first (order matters), then style, cast, composition, NO_TEXT.
 * Only the opening picture (index 0) gets the hook treatment.
 */
export function scenePrompt(cast: ReelCast, idea: string, beat: string, index: number): string {
  const hook = index === 0;
  const moment = hook ? "one striking, high-emotion moment" : "one tender moment";
  const lens = hook ? HOOK_LENS : beat === "close" ? CLOSE_LENS : DEFAULT_LENS;
  return [
    `A single full-bleed vertical 9:16 picture of ${moment}. Moment: ${clean(idea)}. Lens: ${lens}.`,
    `${KNIT_STYLE} Characters (the same two dolls in every picture): ${clean(cast.adult)}; ${clean(cast.child)}.`,
    "Composition: the handmade set fills the whole frame edge to edge; the dolls and their action sit in the upper and middle part of the frame, and the band just below the middle is calm and uncluttered — a soft, simple, evenly lit stretch of the scene's own floor, blanket or background.",
    NO_TEXT,
  ].join("\n");
}
