import { REEL_THEME_IDS, type LegacyThemeId, type ReelThemeId, type ReelThemeRow, type ThemePreviewStatus } from "@/lib/db/types";
import { CRAYON_GUIDE, RED_THREAD_GUIDE } from "./guide-text";

// The visual themes. From migration 012 only the 2 guide styles (Crayon, Red Thread) are offered; the 8 themes of
// migration 007 stay in the database (inactive) so old reels can still re-render and redo images. The database row
// is the source of truth for the preview; this static map mirrors the seeds so prompts can be built before a
// migration runs and in tests. The 8 old style blocks are positive-only (Z-Image runs at cfg 1) and never say
// "camera"; the 2 guide styles use the owner's master prompts verbatim (lib/reels/guide-text.ts).

/** What the prompt builder needs from a theme: its style block and whether faces carry the feeling. */
export type ReelTheme = Pick<ReelThemeRow, "id" | "style" | "faces">;

/** New reels and the Settings default (migration 012). */
export const DEFAULT_THEME_ID: ReelThemeId = "crayon";
/** A reel with no theme (written before 007, or its theme deleted) is drawn as Knitted Doll, like the worker. */
export const LEGACY_THEME_ID: ReelThemeId = "knitted";

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

/** The seeds of migrations 012 (the guide styles' first paragraph) and 007, verbatim (style + faces). */
export const STATIC_THEMES: Record<ReelThemeId, ReelTheme> = {
  crayon: { id: "crayon", faces: true, style: CRAYON_GUIDE.style },
  redthread: { id: "redthread", faces: true, style: RED_THREAD_GUIDE.style },
  knitted: { id: "knitted", faces: false, style: KNIT_STYLE },
  animated3d: {
    id: "animated3d", faces: true,
    style: "Stylized 3D animated feature-film still: characters with appealing rounded proportions, slightly oversized heads and large expressive eyes with bright catchlights, soft smooth skin with a subtle warm glow, rich and clearly readable facial expressions with expressive brows and mouths, softly sculpted hair. Polished family-movie rendering with global illumination, soft volumetric window light, a warm rim light, gentle bounce light and soft ambient shadows. A cozy, richly detailed home set with rounded furniture and tactile fabrics. Palette: warm cream, honey gold, soft peach and terracotta with teal accents. Shallow depth of field, heartwarming and full of life.",
  },
  watercolor: {
    id: "watercolor", faces: true,
    style: "Storybook watercolor illustration painted by hand on textured cold-press paper: soft transparent washes, gentle wet-in-wet blooms and pigment granulation, visible paper grain, delicate fine ink and pencil linework around the figures, soft painted edges. Characters drawn with simple, gentle rounded features, rosy cheeks and warm expressive faces. Warm light painted as luminous washes of pale yellow and peach. Palette: soft peach, warm ochre, rose, sage green and sky blue on warm ivory paper. Airy and tender, a classic children's picture-book page.",
  },
  clay: {
    id: "clay", faces: true,
    style: "Handmade clay stop-motion animation still: every character and object is sculpted from smooth matte modelling clay with subtle fingerprints and tool marks, soft rounded chunky forms, slightly oversized heads, small glossy bead eyes and sculpted expressive mouths and brows. A miniature handcrafted set built from clay, painted card and fabric, with tiny clay props. Soft warm light from the window, gentle soft shadows, miniature tabletop scale with a shallow depth of field. Palette: warm cream, terracotta, mustard, soft teal and dusty pink. Charming, tactile and playful.",
  },
  papercraft: {
    id: "papercraft", faces: false,
    style: "Handmade layered paper-craft diorama, photographed up close as a real tabletop paper model: every character, object and wall is cut from thick coloured cardstock and textured craft paper, built in many stacked layers that stand apart with real depth and soft shadows between them, crisp hand-cut edges with tiny white paper cores showing, visible paper fibre texture, gentle folds and curls. Characters are cut-paper figures made of simple layered paper shapes, with cut-paper hair, small dot eyes and curved paper smiles, posed with clear expressive gestures. A cozy paper room with a layered paper window, paper curtains and paper sunbeams. Soft warm light from the side casting gentle depth shadows between the layers. Palette: warm cream, coral, mustard, teal and soft pink paper. Handmade, whimsical and tactile.",
  },
  anime: {
    id: "anime", faces: true,
    style: "Soft anime illustration in a gentle slice-of-life film style: clean confident line art, smooth cel shading with soft gradient shadows, large expressive eyes with layered highlights, a delicate blush on the cheeks, softly flowing hair drawn in clean shapes. A painterly, detailed background of a cozy sunlit home, warm afternoon light streaming in with a soft bloom and glowing dust motes. Palette: warm cream, soft peach, butter yellow, sky blue and leafy green. Tender, heartfelt and luminous.",
  },
  sketch: {
    id: "sketch", faces: true,
    style: "Black-and-white grayscale pencil drawing, a pure black-and-white graphite study made by hand on white sketchbook paper: the whole picture is pure greyscale, drawn entirely in shades of pencil grey, so every garment, skin tone, hair colour and object reads only as a lighter or darker graphite grey, from soft silver to deep charcoal black, on white paper. Confident graphite line work, expressive loose strokes, soft cross-hatching and smudged tonal shading, visible paper texture, the brightest highlights left as bare white paper, the drawing filling the whole page. Faces drawn with care and clear, readable expressions. Gentle light from the window rendered with soft shading. Intimate, artistic and timeless, a classic monochrome pencil study.",
  },
  cinematic: {
    id: "cinematic", faces: true,
    style: "Cinematic real-life photograph, a still from a modern drama film: real people with natural skin texture, fine hair detail and genuine, readable emotion. 35mm film look with soft natural grain, shallow depth of field and creamy background bokeh. Warm golden-hour sunlight streaming through the window, a soft haze in the light, a gentle rim light on the hair, rich natural colour grading with warm highlights and soft teal shadows. A lived-in, cozy home with real textures. Intimate, emotional and true to life.",
  },
};

/**
 * The short style tag per theme (playbook v2, ≤ 12 words) that ends every reel image prompt: the long style block is
 * condensed so the shot, the moment and the characters lead the prompt. The long block stays for theme previews.
 * Positive-only, never "camera", no lighting (the prompt sets the light per line).
 */
export const STYLE_TAG: Record<LegacyThemeId, string> = {
  knitted: "handmade amigurumi crochet doll photography, visible stitches, felt and yarn set",
  animated3d: "stylized 3D animated feature-film still, soft global illumination, warm honey palette",
  watercolor: "storybook watercolor illustration on textured paper, soft washes, fine ink lines",
  clay: "handmade clay stop-motion still, matte clay with fingerprints, miniature tabletop set",
  papercraft: "layered cut-paper diorama, thick cardstock layers, soft depth shadows between layers",
  anime: "soft slice-of-life anime illustration, clean line art, gentle cel shading",
  sketch: "black-and-white graphite pencil drawing on white sketchbook paper, soft cross-hatching",
  cinematic: "cinematic real-life film still, natural skin texture, 35mm film grain",
};

export const isThemeId = (x: unknown): x is ReelThemeId =>
  typeof x === "string" && (REEL_THEME_IDS as readonly string[]).includes(x);

/** The static copy of a theme; an unknown / empty id is an old reel's: Knitted Doll. */
export const staticTheme = (id?: string | null): ReelTheme => STATIC_THEMES[isThemeId(id) ? id : LEGACY_THEME_ID];

/** A theme row from the database if it is usable, else the static copy of that id (or knitted). */
export function themeOf(row: unknown, id?: string | null): ReelTheme {
  const r = (row && typeof row === "object" ? row : {}) as Partial<ReelTheme>;
  if (isThemeId(r.id) && typeof r.style === "string" && r.style.trim() && typeof r.faces === "boolean") {
    return { id: r.id, style: r.style, faces: r.faces };
  }
  return staticTheme(isThemeId(r.id) ? r.id : id);
}

/**
 * The style tag for pictures with nobody in them (objects, empty places, B-roll): no doll, face, skin or character
 * wording, so a bottle never gets a face and no stranger walks in.
 */
export const STILL_STYLE_TAG: Record<LegacyThemeId, string> = {
  knitted: "handmade felt and yarn miniature set photography, visible stitches, soft textiles",
  animated3d: "stylized 3D animated feature-film still, soft global illumination, warm honey palette",
  watercolor: "storybook watercolor illustration on textured paper, soft washes, fine ink lines",
  clay: "handmade clay stop-motion still, matte clay with fingerprints, miniature tabletop set",
  papercraft: "layered cut-paper diorama, thick cardstock layers, soft depth shadows between layers",
  anime: "soft slice-of-life anime background art, clean line art, gentle cel shading",
  sketch: "black-and-white graphite pencil drawing on white sketchbook paper, soft cross-hatching",
  cinematic: "cinematic real-life film still, fine film grain, shallow depth of field",
};

/** The short style tag of an old theme (any other id → knitted's); `still` = the people-free variant. */
export const styleTag = (t: Pick<ReelTheme, "id">, still = false) => {
  const tags: Record<string, string> = still ? STILL_STYLE_TAG : STYLE_TAG;
  return tags[t.id] ?? tags[LEGACY_THEME_ID];
};

/** Knitted Doll draws every character as a crocheted doll: the cast and ideas are written as dolls. */
export const isDollTheme = (t: Pick<ReelTheme, "id">) => t.id === "knitted";

// ---------------------------------------------------------------- UI helpers (Settings grid + review picker)

/** Name + emoji per theme (mirrors the 012 + 007 seeds; the DB row wins when the page has it). */
export const THEME_LABEL: Record<ReelThemeId, { label: string; emoji: string }> = {
  crayon: { label: "Crayon", emoji: "🖍️" },
  redthread: { label: "Red Thread", emoji: "🧵" },
  knitted: { label: "Knitted Doll", emoji: "🧶" },
  animated3d: { label: "3D Animated", emoji: "🎬" },
  watercolor: { label: "Storybook Watercolor", emoji: "🎨" },
  clay: { label: "Clay Stop-motion", emoji: "🏺" },
  papercraft: { label: "Paper Craft", emoji: "✂️" },
  anime: { label: "Soft Anime", emoji: "🌸" },
  sketch: { label: "Pencil Sketch (B&W)", emoji: "✏️" },
  cinematic: { label: "Cinematic Real", emoji: "📷" },
};
/** "🎬 3D Animated" for any id (unknown / null -> Knitted Doll, an old reel's look). */
export const themeName = (id?: string | null) => {
  const t = THEME_LABEL[isThemeId(id) ? id : LEGACY_THEME_ID];
  return `${t.emoji} ${t.label}`;
};

/** Badge text + tone per preview status (ready shows the picture instead). */
export const PREVIEW_LABEL: Record<ThemePreviewStatus, { label: string; tone: "ok" | "muted" | "accent" | "bad" }> = {
  missing: { label: "No preview", tone: "muted" },
  queued: { label: "In line", tone: "muted" },
  making: { label: "Making…", tone: "accent" },
  ready: { label: "Ready", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
};
/** "Make all previews" queues these: no preview yet, or the last one failed. */
export const needsPreview = (t: Pick<ReelThemeRow, "preview_status">) => t.preview_status === "missing" || t.preview_status === "failed";
/** In line or being made: "Make preview" waits. */
export const previewBusy = (t: Pick<ReelThemeRow, "preview_status">) => t.preview_status === "queued" || t.preview_status === "making";
/** A ready preview with a path (counts as made; the review picker shows these). */
export const previewPath = (t: Pick<ReelThemeRow, "preview_status" | "preview_path">) => (t.preview_status === "ready" && t.preview_path) || null;
/** The picture a card shows: the ready preview, or the old one while "Make again" waits in line / is being made
 *  (queueing keeps preview_path; the worker swaps it only when the new picture is saved). */
export const previewShown = (t: Pick<ReelThemeRow, "preview_status" | "preview_path">) =>
  previewPath(t) ?? ((previewBusy(t) && t.preview_path) || null);
/** setReelThemeAction's "saved, but not every picture prompt was rebuilt" messages start with this: the picker
 *  then offers Retry (re-applying the same theme), which a normal pick of the current theme would skip. */
export const THEME_PARTIAL = "The theme was saved, but";
export const isPartialThemeSave = (error: string) => error.startsWith(THEME_PARTIAL);
/** Offered in the pickers: every theme before 012 (no `active` column), only the 2 guide styles after it. */
export const isActiveTheme = (t: Pick<ReelThemeRow, "active">) => t.active !== false;
/** Display order (the seed's sort, then id). */
export const byThemeOrder = (a: Pick<ReelThemeRow, "sort" | "id">, b: Pick<ReelThemeRow, "sort" | "id">) => a.sort - b.sort || a.id.localeCompare(b.id);
