// The owner's two reel style guides, word for word (docs/reference/crayon-parenting-prompt.md and
// red-thread-parenting-prompt.md, copied from the repo root). Only the [SCENE] / [THREAD] / feeling slots change per
// picture; everything here stays exactly as the owner tested it, "not …" / "no …" sentences included (the one
// exception to the positive-only rule, for these two styles only). A leaf module: no imports, so themes.ts,
// the prompt builder and the tests can all read it.

/** Crayon master prompt: the style paragraph, the depth paragraph and the closing paragraph around [SCENE]. */
export const CRAYON_GUIDE = {
  style:
    "A rough wax crayon drawing on white paper, drawn by hand with heavy pressure. Thick waxy crayon strokes going in visible directions, " +
    "streaky uneven coloring, white paper grain showing through the gaps between strokes, coloring slightly outside the lines, " +
    "scribbly cross-hatching for shading, and bold wobbly dark crayon outlines around every shape. " +
    "Looks like a real crayon artwork scanned from paper, not a painting.",
  depth:
    "The scene has depth, with detailed objects in the close foreground, the characters in the middle ground, " +
    "and a smaller, paler background in the distance.",
  close:
    "Warm soft light from one side, with a glowing crayon outline along the characters' hair and shoulders, " +
    "and darker crayon hatching on the shadow side. Bold saturated colors, expressive emotional storybook crayon style. " +
    "Not a painting, not smooth, no blending, no gradients, not photorealistic, no crayons or art supplies visible in the image, no text.",
} as const;

/** Red Thread master prompt: the style paragraph, the depth paragraph and the closing paragraph around [SCENE] + [THREAD]. */
export const RED_THREAD_GUIDE = {
  style:
    "A clean black and white ink line illustration in a simple modern storybook style. Smooth confident outlines of even thickness, " +
    "simple rounded shapes, minimal details, and soft flat grey tones. Light warm grey background with subtle paper texture. " +
    "The entire image is monochrome grayscale except for one single thin bright red thread, the only color in the image.",
  depth:
    "The scene has depth: the main characters in the foreground with the boldest black outlines, simple furniture in the middle ground " +
    "with thinner grey lines, and the background faded into pale grey.",
  close:
    "Grayscale everything except the red thread. Not photorealistic, not 3D, no pencil sketch texture, no other colors, no text.",
} as const;

/** Red Thread quick fix "Other red objects appear": said at the start and at the end of every prompt. */
export const ONLY_RED = "The red thread is the only color in the image.";
/** Red Thread quick fix "Thread too small / hard to see": in every thread line. */
export const PHONE_VISIBLE = "thick enough to be clearly visible on a phone screen";

/** The Crayon preview: the guide's "Mother and newborn" example scene, verbatim. */
export const CRAYON_PREVIEW_SCENE =
  "A young mother with long flowing hair holds a swaddled baby close to her chest, head tilted down, gazing at the baby with a wide " +
  "joyful smile, eyes crinkled shut from happiness, and bright rosy scribbled cheeks. The baby laughs up at her with a big open-mouth " +
  "smile and sparkling eyes, one tiny hand reaching toward her face. Tall grass and wildflowers in the foreground, small pale mountains " +
  "under a sunset sky behind. The feeling is pure love and warmth.";

/** The Red Thread preview: the guide's "2. Newborn" example (scene, thread line A, feeling), verbatim. */
export const RED_THREAD_PREVIEW = {
  scene:
    "A young mother sits on a bed holding her newborn baby in her arms, looking down with a soft loving smile and closed curved eyes. " +
    "The baby sleeps peacefully with a tiny smile.",
  thread:
    "A clearly visible thin bright red thread is tied in a small bow around the mother's wrist and tied around the baby's tiny wrist, " +
    "one continuous thread connecting both wrists, with a short end trailing onto the blanket.",
  feeling: "a love that just began",
} as const;
