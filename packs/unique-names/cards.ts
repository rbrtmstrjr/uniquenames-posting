import type { Angle, Frame, Session, ShotSpec } from "@/lib/planner/shots";
import type { CoverPose, CoverTitle, CoverTitleInput, PackCards } from "../types";

// Unique Names name cards: the children's looks, the photoshoot shot lists and the closing card's moment.
// Story shots (2026-10-18): the shot lists are a photographer's session plan, mostly close-ups and macros, each frame
// with ONE hero (the face, a detail, or one prop as "{prop}"). Every shot text is stored on its card, so a text must
// stay unique; cards made before story shots keep their own stored prompt (their texts no longer map to a spec).

// Looks written for the page's audience; one is picked per child and repeated word for word.
const LOOKS = [
  "soft wispy dark hair, warm light-tan skin and big brown eyes",
  "short fine black hair, fair skin and round chubby cheeks",
  "a little tuft of dark brown hair, warm medium skin and dark eyes",
  "soft light brown hair, fair rosy skin and bright eyes",
  "thick soft black hair, warm tan skin and long eyelashes",
  "very fine short hair, light skin and big curious eyes",
];
// The same six looks for children of 2 and up, whose hair has grown in (same index = same family look).
// No "rosy": on older children the model paints it as round red blush spots.
const CHILD_LOOKS = [
  "soft dark hair, warm light-tan skin and big brown eyes",
  "straight black hair, fair skin and a sweet round face",
  "dark brown hair, warm medium skin and dark eyes",
  "light brown hair, fair skin with natural freckles and bright eyes",
  "thick black hair, warm tan skin and long eyelashes",
  "fine light brown hair, light skin and big curious eyes",
];

// Lens + aperture per frame give the photoshoot its depth: a portrait lens wide open melts the set into creamy blur,
// a macro lens isolates one small thing. (Never the word for the device itself: the model draws it.)
const PORTRAIT = "85mm portrait lens, f/1.4, very shallow depth of field, creamy bokeh";
const CLOSE = "85mm portrait lens, f/1.2, close-up, razor-thin depth of field";
const MACRO = "100mm macro lens, f/2.8, extreme close-up, background melted into blur";
// A focus pull onto a prop: the macro lens right at the prop, the child further back falls into a soft blur.
const PULL = "100mm macro lens, f/2, extremely shallow depth of field, creamy bokeh";
// Props-only frames: the same optics without the word "portrait", which could pull a person into an empty set.
const STILL = "85mm lens, f/1.8, very shallow depth of field";

const shot = (frame: Exclude<Frame, "still">, angle: Angle, text: string, focus: string, camera: string): ShotSpec =>
  ({ kind: "baby", text, camera, angle, space: "top", frame, focus });
// A focus pull (owner's samples): the macro lens right at the prop, the child behind it completely out of focus.
const pull = (angle: Angle, text: string, focus: string, camera: string): ShotSpec => ({ ...shot("story", angle, text, focus, camera), childSoft: true });
const still = (angle: Angle, text: string, focus: string, camera: string): ShotSpec =>
  ({ kind: "props", text, camera, angle, space: "top", frame: "still", focus });

// Index 0 of each session is the album cover. Per session: portraits (the face, different angles and moments), prop
// stories (the child with one prop, focus on the prop or on the face), details (hands, feet, no face) and hands
// frames (small hands with one prop, no face).
const SITTER_SHOTS: ShotSpec[] = [
  shot("story", "eye", "close-up portrait of the baby sitting and holding {prop} with both hands, looking straight at the viewer with a sweet smile",
    "sharp focus on the eyes and {prop}; the set melts into creamy bokeh", `eye level, ${PORTRAIT}`),
  shot("portrait", "closeup", "tight close-up portrait of the baby's face with a gummy smile and big curious eyes",
    "sharp focus on the eyes; the far cheek and the background fall into soft blur", `eye level, ${CLOSE}`),
  shot("portrait", "high", "close-up from slightly above of the baby sitting and looking up at the viewer with wide wondering eyes",
    "sharp focus on the eyes; the floor around falls into creamy bokeh", `high-angle viewpoint from slightly above, ${PORTRAIT}`),
  shot("portrait", "profile", "three-quarter close-up of the baby looking off to the side with a soft surprised expression",
    "sharp focus on the near eye and the eyelashes", `eye level, three-quarter angle, ${PORTRAIT}`),
  shot("portrait", "eye", "candid close-up of the baby laughing with the eyes squeezed shut and the head tilted",
    "sharp focus on the laughing face", `slightly above eye level, candid, ${PORTRAIT}`),
  shot("portrait", "low", "floor-level close-up of the baby lying on the tummy with the head lifted, smiling straight at the viewer",
    "sharp focus on the eyes; the floor in front melts into soft foreground blur", `floor-level viewpoint, ${PORTRAIT}`),
  pull("low", "photograph taken with a macro lens right next to {prop} on the floor: {prop} is tack sharp in the foreground, and the baby crawling toward it from behind is completely out of focus, the face a soft blur of color",
    "sharp focus on {prop}; the baby behind it is a soft blur of color", `floor-level viewpoint, low angle, ${PULL}`),
  shot("story", "pov", "close-up view from just behind the baby's shoulder: the baby's own head and shoulder a soft blur in the near foreground, and the baby's own small hand holding up {prop}",
    "sharp focus on {prop} in the small hand; the head in the foreground is a soft blur", `viewpoint just behind the baby at the baby's eye level, ${PORTRAIT}`),
  shot("story", "high", "close-up from slightly above of the baby sitting and looking down at {prop} in the lap with full concentration",
    "sharp focus on {prop} and the small hands; the face just soft", `high-angle viewpoint from slightly above, ${PORTRAIT}`),
  shot("story", "profile", "close-up of the baby peeking over the top of {prop} with big curious eyes",
    "sharp focus on the eyes and the top edge of {prop}", `eye level, ${PORTRAIT}`),
  shot("detail", "macro", "macro close-up from above of the baby sitting up and holding one chubby bare foot with both small hands, the little toes curled",
    "sharp focus on the little toes and fingers; the legs and the set fall into soft blur", `top-down viewpoint from above, ${MACRO}`),
  shot("detail", "closeup", "macro close-up of the baby's small chubby hands resting together on the knit outfit",
    "sharp focus on the little fingers and the knit texture", `slightly above, ${MACRO}`),
  shot("hands", "macro", "macro close-up of the baby's small hands holding {prop}; only the hands, {prop} and the sleeves in the frame",
    "sharp focus on {prop} and the little fingers; everything else melts into soft blur", `slightly above, ${MACRO}`),
  shot("hands", "low", "close-up of the baby's small hand reaching in from the side of the frame to touch {prop}",
    "sharp focus on {prop} and the reaching fingertips; the rest dissolves into creamy bokeh", `floor-level viewpoint, low angle, ${PULL}`),
];

// Newborns sleep: the props rest beside them, a tiny hand rests on a prop.
const NEWBORN_SHOTS: ShotSpec[] = [
  shot("story", "eye", "close-up of the newborn sleeping peacefully, curled up and nestled against {prop}, the tiny face turned toward the viewer",
    "sharp focus on the closed eyes and the tiny nose; {prop} and the set melt into soft creamy blur", `eye level, ${PORTRAIT}`),
  shot("portrait", "closeup", "tight close-up of the newborn's sleeping face resting on the folded hands, the eyelashes resting on the cheeks",
    "sharp focus on the eyelashes and the tiny lips; everything else melts into soft blur", `eye level, ${CLOSE}`),
  shot("portrait", "high", "close-up from slightly above of the newborn sleeping on the side, snugly wrapped, one tiny hand by the cheek",
    "sharp focus on the face and the tiny hand; the blanket falls into soft blur", `high-angle viewpoint from slightly above, ${PORTRAIT}`),
  shot("portrait", "profile", "side profile close-up of the newborn sleeping on the tummy, the chin resting on the stacked hands",
    "sharp focus on the profile, the tiny nose and the lips", `eye level, side profile, ${PORTRAIT}`),
  shot("portrait", "eye", "close-up of the newborn mid-yawn, the tiny mouth open and the nose scrunched",
    "sharp focus on the little yawning face", `eye level, ${PORTRAIT}`),
  shot("portrait", "overhead", "overhead close-up looking straight down at the newborn sleeping curled up on a soft blanket",
    "sharp focus on the sleeping face; the blanket edges soft", "top-down viewpoint, 50mm lens, f/1.8, shallow depth of field"),
  pull("low", "photograph taken with a macro lens right next to {prop} on the blanket: {prop} is tack sharp in the foreground, and the sleeping newborn just behind it is completely out of focus, a soft blur of color",
    "sharp focus on {prop}; the sleeping newborn behind it is a soft blur", `blanket-level viewpoint, ${PULL}`),
  shot("story", "high", "close-up from slightly above of the newborn sleeping with {prop} tucked in the crook of the arm",
    "sharp focus on the sleeping face and {prop}", `high-angle viewpoint from slightly above, ${PORTRAIT}`),
  shot("story", "profile", "side profile close-up of the sleeping newborn's face resting right beside {prop}",
    "sharp focus on the eyelashes and the near edge of {prop}; everything else dissolves into creamy bokeh", `eye level, side profile, ${CLOSE}`),
  shot("detail", "macro", "macro close-up from the side of the newborn curled up asleep on the blanket, the tiny feet tucked together under the body, the little toes curled",
    "sharp focus on the tiny toes; the blanket falls into soft blur", `side view, slightly above, ${MACRO}`),
  shot("detail", "closeup", "macro close-up of the newborn's tiny fingers curled into a soft fist on the knit outfit",
    "sharp focus on the tiny fingers and the knit texture", `slightly above, ${MACRO}`),
  shot("hands", "macro", "macro close-up of the newborn's tiny hand resting on {prop}, the fingers softly curled; only the hand, {prop} and a little sleeve in the frame",
    "sharp focus on the tiny fingers and {prop}; everything else melts into soft blur", `slightly above, ${MACRO}`),
  shot("hands", "profile", "close-up from the side of the newborn curled up asleep beside {prop}, the tiny feet tucked together, the little toes curled",
    "sharp focus on the toes and {prop}; the rest dissolves into creamy bokeh", "side view, 100mm macro lens, f/2.8, shallow depth of field"),
];

// 2–3 years: sitting, playing, peeking, on the move.
const TODDLER_SHOTS: ShotSpec[] = [
  shot("story", "eye", "close-up portrait of the toddler sitting on the floor hugging {prop}, smiling straight at the viewer",
    "sharp focus on the eyes and {prop}; the set melts into creamy bokeh", `eye level, ${PORTRAIT}`),
  shot("portrait", "closeup", "tight close-up portrait of the toddler's face with a big cheeky grin",
    "sharp focus on the eyes; the far cheek and the background fall into soft blur", `eye level, ${CLOSE}`),
  shot("portrait", "high", "close-up from slightly above of the toddler sitting on the floor and looking up at the viewer with wide eyes and a little smile",
    "sharp focus on the eyes; the floor around falls into creamy bokeh", `high-angle viewpoint from slightly above, ${PORTRAIT}`),
  shot("portrait", "profile", "three-quarter close-up of the toddler sitting and looking back over the shoulder at the viewer",
    "sharp focus on the near eye", `eye level, three-quarter angle, ${PORTRAIT}`),
  shot("portrait", "eye", "candid close-up of the toddler sitting and laughing with the eyes squeezed shut",
    "sharp focus on the laughing face", `slightly above eye level, candid, ${PORTRAIT}`),
  shot("portrait", "low", "playful close-up of the toddler sitting and peeking out between both hands with delighted eyes",
    "sharp focus on the eyes between the fingers", `low angle, ${PORTRAIT}`),
  pull("low", "photograph taken with a macro lens right next to {prop} on the floor: {prop} is tack sharp in the foreground, and the toddler lying on the tummy and watching it from behind is completely out of focus, the face a soft blur of color",
    "sharp focus on {prop}; the toddler behind it is a soft blur of color", `floor-level viewpoint, low angle, ${PULL}`),
  shot("story", "pov", "close-up view from just behind the toddler's shoulder: the toddler's own head and shoulder a soft blur in the near foreground, and the toddler's own small hand holding up {prop}",
    "sharp focus on {prop} in the small hand; the head in the foreground is a soft blur", `viewpoint just behind the toddler at the toddler's eye level, ${PORTRAIT}`),
  shot("story", "profile", "close-up of the toddler peeking over the top of {prop} with big curious eyes",
    "sharp focus on the eyes and the top edge of {prop}", `eye level, ${PORTRAIT}`),
  shot("story", "high", "close-up from slightly above of the toddler sitting cross-legged and playing with {prop} on the floor, deeply focused",
    "sharp focus on {prop} and the small hands; the face just soft", `high-angle viewpoint from slightly above, ${PORTRAIT}`),
  shot("detail", "macro", "macro close-up from the side of the toddler sitting on the floor with the small bare feet crossed at the ankles, the little toes curled",
    "sharp focus on the toes; the legs and the set fall into soft blur", `side view, ${MACRO}`),
  shot("detail", "closeup", "macro close-up of the toddler's small hands and the knit cuffs of the outfit",
    "sharp focus on the little fingers and the knit texture", `slightly above, ${MACRO}`),
  shot("hands", "macro", "macro close-up of the toddler's small hands holding {prop}; only the hands, {prop} and the sleeves in the frame",
    "sharp focus on {prop} and the little fingers; everything else melts into soft blur", `slightly above, ${MACRO}`),
  shot("hands", "low", "close-up of the toddler's small hand reaching in from the side of the frame toward {prop}",
    "sharp focus on {prop} and the reaching fingertips; the rest dissolves into creamy bokeh", `floor-level viewpoint, low angle, ${PULL}`),
];

// 4–7 years: posed portraits and candid moments. (No word for light in these texts: the model draws a lamp.)
const KID_SHOTS: ShotSpec[] = [
  shot("story", "eye", "close-up portrait of the child sitting on the floor and holding {prop} close to the chest with both arms, smiling straight at the viewer",
    "sharp focus on the eyes and {prop}; the set melts into creamy bokeh", `eye level, ${PORTRAIT}`),
  shot("portrait", "closeup", "tight close-up portrait of the child's face with a natural happy smile",
    "sharp focus on the eyes; the far cheek and the background fall into soft blur", `eye level, ${CLOSE}`),
  shot("portrait", "high", "close-up from slightly above of the child sitting cross-legged and looking up at the viewer with a bright smile",
    "sharp focus on the eyes; the floor around falls into creamy bokeh", `high-angle viewpoint from slightly above, ${PORTRAIT}`),
  shot("portrait", "profile", "three-quarter close-up of the child sitting and looking back over the shoulder at the viewer with a soft smile",
    "sharp focus on the near eye", `eye level, three-quarter angle, ${PORTRAIT}`),
  shot("portrait", "eye", "candid close-up of the child sitting and laughing with the head tilted back",
    "sharp focus on the laughing face", `slightly above eye level, candid, ${PORTRAIT}`),
  shot("portrait", "low", "close-up of the child lying on the tummy with the chin resting in both hands, gazing off to the side, lost in thought",
    "sharp focus on the eyes", `floor-level viewpoint, low angle, ${PORTRAIT}`),
  pull("low", "photograph taken with a macro lens right next to {prop} on the floor: {prop} is tack sharp in the foreground, and the child lying on the tummy and looking at it from behind is completely out of focus, the face a soft blur of color",
    "sharp focus on {prop}; the child behind it is a soft blur of color", `floor-level viewpoint, low angle, ${PULL}`),
  shot("story", "pov", "close-up view from just behind the child's shoulder: the child's own head and shoulder a soft blur in the near foreground, and the child's own hand holding up {prop}",
    "sharp focus on {prop} in the hand; the head in the foreground is a soft blur", `viewpoint just behind the child at the child's eye level, ${PORTRAIT}`),
  shot("story", "profile", "close-up of the child peeking over the top of {prop} with a playful look",
    "sharp focus on the eyes and the top edge of {prop}", `eye level, ${PORTRAIT}`),
  shot("story", "high", "close-up from slightly above of the child sitting cross-legged on the floor, playing with {prop}, absorbed",
    "sharp focus on {prop} and the hands; the face just soft", `high-angle viewpoint from slightly above, ${PORTRAIT}`),
  shot("detail", "macro", "macro close-up from the side of the child sitting cross-legged on the floor, the bare feet tucked in and the toes curled",
    "sharp focus on the toes; the legs and the set fall into soft blur", `side view, ${MACRO}`),
  shot("detail", "closeup", "macro close-up of the child's hands resting together on the knee, the cuffs of the outfit in the frame",
    "sharp focus on the fingers and the fabric texture", `slightly above, ${MACRO}`),
  shot("hands", "macro", "macro close-up of the child's hands holding {prop}; only the hands, {prop} and the sleeves in the frame",
    "sharp focus on {prop} and the fingers; everything else melts into soft blur", `slightly above, ${MACRO}`),
  shot("hands", "low", "close-up of the child's hand reaching in from the side of the frame to pick up {prop}",
    "sharp focus on {prop} and the reaching fingertips; the rest dissolves into creamy bokeh", `floor-level viewpoint, low angle, ${PULL}`),
];

// Still lifes: one hero prop, nobody in the picture, the other props at most soft shapes behind.
const PROPS_SPECS: ShotSpec[] = [
  still("low", "props-only close-up still life from floor level of {prop} resting on the floor, the floor stretching toward the viewer in soft foreground blur",
    "sharp focus on {prop}; the floor in front and the set behind melt into creamy bokeh", `floor-level viewpoint, low angle, ${STILL}`),
  still("macro", "props-only macro close-up of {prop}, every texture crisp",
    "sharp focus on the details of {prop}; everything else melts into soft blur", `eye level, ${MACRO}`),
  still("eye", "props-only close-up of {prop} on its own, the other props as soft blurred shapes behind it",
    "sharp focus on {prop}", `eye level, ${STILL}`),
  still("overhead", "props-only overhead close-up looking straight down at {prop} resting on a soft folded blanket",
    "sharp focus on {prop}; the blanket edges soft", "top-down viewpoint, 50mm lens, f/2.8, soft focus falloff at the edges"),
  still("closeup", "props-only close-up of the empty outfit folded neatly with {prop} resting on it",
    "sharp focus on {prop} and the fabric texture", `slightly above, ${STILL}`),
];

// The child (or the sleeping newborn) and the props low in the frame, so the upper half stays
// open backdrop for the follow message the worker stamps there. Same optics words as the wide
// frames of the session.
const CTA_MOMENT: Record<Session, string> = {
  newborn: "the newborn sleeping peacefully, curled up in the main prop low in the frame, the small props arranged around",
  sitter: "the baby crawling happily across the blanket toward the viewer beside the main prop, low in the frame",
  toddler: "the toddler sitting on the blanket beside the main prop, low in the frame, smiling at the viewer",
  kid: "the child sitting cross-legged on the blanket beside the main prop, low in the frame, smiling at the viewer",
};

// The front card (migration 023): the album's first picture, the post's title stamped big by the PC. Ten poses, each
// written for every session (a newborn sleeps; a toddler may stand); the planner takes the least recently used one,
// never the previous post's. The prompt adds where the child and props sit, so the title's third stays calm. Optics
// words only, never the device or the room ("camera", "studio" and "lamp" make the model draw them); tummy poses keep
// the legs out of view (soles toward the viewer read as lifeless).
const COVER_POSES: CoverPose[] = [
  { id: "wide", optics: "eye level, wide shot, 35mm lens, f/2.0, soft background falloff", moment: {
    newborn: "the newborn sleeping peacefully in the middle of the whole scene, curled up on the blanket beside the main prop, every prop in view",
    sitter: "the baby sitting in the middle of the whole scene beside the main prop, smiling at the viewer, every prop in view",
    toddler: "the toddler sitting in the middle of the whole scene beside the main prop, smiling at the viewer, every prop in view",
    kid: "the child sitting cross-legged in the middle of the whole scene beside the main prop, smiling at the viewer, every prop in view",
  } },
  { id: "face", places: ["top"], optics: "eye level, 85mm portrait lens, f/1.8, shallow depth of field, creamy bokeh", moment: {
    newborn: "a head-and-shoulders portrait of the newborn asleep, snug in a soft wrap, the tiny face turned toward the viewer in the lower half of the frame, calm open space above",
    sitter: "a head-and-shoulders portrait of the baby looking straight at the viewer with big curious eyes and a little smile, the face in the lower half of the frame, calm open space above",
    toddler: "a head-and-shoulders portrait of the toddler looking straight at the viewer with a cheeky grin, the face in the lower half of the frame, calm open space above",
    kid: "a head-and-shoulders portrait of the child looking straight at the viewer with a warm smile, the face in the lower half of the frame, calm open space above",
  } },
  { id: "top-down", optics: "top-down viewpoint, 50mm lens, f/2.8, soft focus falloff at the edges", moment: {
    newborn: "the newborn sleeping curled up on the soft blanket, seen straight from above, the props arranged around",
    sitter: "the baby lying on the back on the soft blanket, seen straight from above, smiling up at the viewer, the props arranged around",
    toddler: "the toddler lying on the back on the soft blanket, seen straight from above, giggling up at the viewer, the props arranged around",
    kid: "the child lying on the back on the soft blanket, seen straight from above, smiling up at the viewer, the props arranged around",
  } },
  { id: "peek", optics: "eye level, 85mm portrait lens, f/2.0, shallow depth of field", moment: {
    newborn: "the sleeping newborn tucked in behind the main prop, the tiny face resting just over its edge",
    sitter: "the baby peeking out from behind the main prop with big curious eyes",
    toddler: "the toddler peeking around the side of the main prop with a playful grin",
    kid: "the child peeking over the top of the main prop with a playful look",
  } },
  { id: "profile-up", optics: "eye level, side profile, 85mm portrait lens, f/2.0, shallow depth of field", moment: {
    newborn: "a side profile of the sleeping newborn, the chin tilted slightly up, the tiny nose and lips in soft profile",
    sitter: "a side profile of the baby sitting and looking up with wonder",
    toddler: "a side profile of the toddler standing and looking up with wonder",
    kid: "a side profile of the child sitting and looking up with a dreamy smile",
  } },
  { id: "among-props", optics: "slightly above eye level, three-quarter angle, 50mm lens, f/2.2, soft background falloff", moment: {
    newborn: "the newborn curled up asleep among the props, seen from a three-quarter angle",
    sitter: "the baby sitting among the props, seen from a three-quarter angle, looking at the viewer",
    toddler: "the toddler sitting among the props, seen from a three-quarter angle, looking at the viewer",
    kid: "the child sitting among the props, seen from a three-quarter angle, looking at the viewer with a soft smile",
  } },
  { id: "hug", optics: "eye level, wide shot, 35mm lens, f/2.0, soft background falloff", moment: {
    newborn: "a wide view of the whole scene with the sleeping newborn snuggled against the softest prop, one tiny hand resting on it, the other props around",
    sitter: "a wide view of the whole scene with the baby cuddling the softest prop close, smiling, the other props around",
    toddler: "a wide view of the whole scene with the toddler cuddling the softest prop close, the eyes closed in a happy squeeze, the other props around",
    kid: "a wide view of the whole scene with the child cuddling the softest prop close with both arms, smiling, the other props around",
  } },
  { id: "tummy", places: ["top"], optics: "floor-level viewpoint, 85mm portrait lens, f/2.0, shallow depth of field", moment: {
    newborn: "the newborn sleeping on the back, tucked in a soft wrap, the chin tilted toward the viewer, low in the frame",
    sitter: "the baby lying on the tummy with the chin resting on both hands, smiling at the viewer, the legs out of view behind",
    toddler: "the toddler lying on the tummy with the chin propped on both hands, smiling at the viewer, the legs out of view behind",
    kid: "the child lying on the tummy with the chin propped on both hands, smiling at the viewer, the legs out of view behind",
  } },
  { id: "over-shoulder", optics: "viewpoint just behind the shoulder at eye level, 50mm lens, f/2.0, soft background falloff", moment: {
    newborn: "a view from just above the sleeping newborn's shoulder, the tiny cheek soft in the near foreground and the props spread out beyond",
    sitter: "a view from just behind the baby's shoulder as the baby looks out at the props, the face in soft three-quarter profile",
    toddler: "a view from just behind the toddler's shoulder as the toddler looks out at the props, the face in soft three-quarter profile",
    kid: "a view from just behind the child's shoulder as the child looks out at the props, the face in soft three-quarter profile",
  } },
  { id: "low-angle", places: ["top"], optics: "low angle from floor level, 35mm lens, f/2.2, soft background falloff", moment: {
    newborn: "the newborn sleeping on the blanket, seen from blanket level, the backdrop rising tall behind",
    sitter: "the baby sitting on the blanket, seen from floor level, the backdrop rising tall behind",
    toddler: "the toddler standing proudly on the blanket, seen from a low angle, the backdrop rising tall behind",
    kid: "the child standing on the blanket with a confident smile, seen from a low angle, the backdrop rising tall behind",
  } },
];

const SMALL_WORDS = new Set(["a", "an", "and", "the", "of", "for", "in", "on", "with"]);
/** "Unique and modern" -> "Unique and Modern": each word and hyphen part capitalised, small words lowercase unless first, the rest kept (a script font has no caps). */
function titleCase(s: string): string {
  return s.split(" ").map((w, i) => w.split("-").map((part, j) => {
    if (SMALL_WORDS.has(part.toLowerCase())) return i === 0 && j === 0 ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part.toLowerCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join("-")).join(" ");
}

/** The front card's title (spec 2026-11-21): "'S' Names", "Biblical Names", "A & R Names", "A to Z Names", "Baby Boy Names". */
function coverTitle(p: CoverTitleInput): CoverTitle {
  const forWho = `for baby ${p.gender}`;
  const letter = p.letter?.trim().toUpperCase();
  if (letter) return { main: `'${letter}' Names`, second: forWho };
  const theme = p.nameTheme?.replace(/\s+/g, " ").trim();
  if (theme) return { main: /names$/i.test(theme) ? theme : `${titleCase(theme)} Names`, second: forWho };
  if (p.initials && /^[A-Z]{2}$/.test(p.initials)) return { main: `${p.initials[0]} & ${p.initials[1]} Names`, second: forWho };
  if (p.seriesPart === 1 || p.seriesPart === 2) return { main: "A to Z Names", second: `part ${p.seriesPart} · ${forWho}` };
  return { main: `Baby ${p.gender === "girl" ? "Girl" : "Boy"} Names`, second: "" };
}

export const UNIQUE_NAMES_CARDS: PackCards = {
  looks: LOOKS,
  childLooks: CHILD_LOOKS,
  newbornShare: 0.35,
  shots: { newborn: NEWBORN_SHOTS, sitter: SITTER_SHOTS, toddler: TODDLER_SHOTS, kid: KID_SHOTS },
  propsShots: PROPS_SPECS,
  ctaMoment: CTA_MOMENT,
  cover: { poses: COVER_POSES, title: coverTitle },
};
