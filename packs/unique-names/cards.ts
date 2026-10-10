import type { Angle, Session, ShotSpec, TextSpace } from "@/lib/planner/shots";
import type { PackCards } from "../types";

// Unique Names name cards: the children's looks, the baby-photoshoot shot lists and the closing card's moment,
// moved word for word from lib/planner/prompt.ts and lib/planner/shots.ts (the stored shot texts of every existing
// post map back to these specs, so the wording must never change for this pack).

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

// Lens + aperture per frame give the photoshoot its depth: a portrait lens wide open melts
// the set into creamy blur behind the baby. (Never the word for the device itself: the model draws it.)
const PORTRAIT = "85mm portrait lens, f/1.8, creamy blurred background";
const CLOSE = "85mm portrait lens, f/1.8, close-up, very shallow depth of field";
const MACRO = "100mm macro lens, f/2.8, extreme close-up, background melted into blur";
const WIDE = "35mm lens, f/2.0, soft background falloff";
const OVERHEAD = "50mm lens, f/2.8, soft focus falloff at the edges";
// Props-only frames: same optics without the word "portrait", which could pull a person into an empty set.
const PROPS_LENS = "85mm lens, f/1.8";

const baby = (text: string, camera: string, angle: Angle, space: TextSpace = "top"): ShotSpec => ({ kind: "baby", text, camera, angle, space });
const props = (text: string, camera: string, angle: Angle, space: TextSpace = "top"): ShotSpec => ({ kind: "props", text, camera, angle, space });

// Index 0 of each session is the album cover.
const SITTER_SHOTS: ShotSpec[] = [
  baby("eye-level medium shot of the baby sitting up in the middle of the set, looking straight ahead at the viewer with a sweet expression", `eye level, medium shot, ${PORTRAIT}`, "eye"),
  baby("wide establishing shot of the whole set with the baby sitting small in the scene among the props", `eye level, wide shot, ${WIDE}`, "wide"),
  baby("high-angle shot looking down at the baby sitting on the blanket and gazing up at the viewer with wide eyes", `high-angle viewpoint from above at 45 degrees looking down, ${PORTRAIT}`, "high", "bottom"),
  baby("low-angle shot from floor level of the baby crawling toward the viewer between the props", `floor-level viewpoint, low angle, ${PORTRAIT}`, "low"),
  baby("tight close-up portrait of the baby's face with a soft smile, the props melting into soft blur behind", CLOSE, "closeup"),
  baby("detail close-up of the baby's tiny hands holding one of the small props", MACRO, "macro"),
  baby("over-the-shoulder view from behind the baby, who sits looking at the props in front of them; the back of the head and the outfit are visible", `viewpoint just behind the baby at the baby's eye level, point of view, ${PORTRAIT}`, "pov"),
  baby("three-quarter side view of the baby reaching out to touch one of the props", `eye level, three-quarter angle, ${PORTRAIT}`, "profile"),
  baby("candid moment of the baby laughing with eyes squeezed shut, sitting beside the props", `slightly above eye level, candid, ${PORTRAIT}`, "eye"),
  baby("tummy-time shot of the baby lying on the tummy with the head lifted, smiling at the viewer", `floor-level viewpoint, ${PORTRAIT}`, "low"),
  baby("detail close-up of the baby's bare feet and toes resting on the blanket next to a small prop", MACRO, "macro"),
];

const NEWBORN_SHOTS: ShotSpec[] = [
  baby("eye-level shot of the newborn sleeping peacefully, curled up in the main prop in the center of the set", `eye level, medium shot, ${PORTRAIT}`, "eye"),
  baby("wide establishing shot of the whole set with the sleeping newborn small in the scene", `eye level, wide shot, ${WIDE}`, "wide"),
  baby("top-down bird's-eye shot of the newborn sleeping curled on a soft blanket with the small props arranged around", `top-down viewpoint looking straight down, ${OVERHEAD}`, "overhead", "bottom"),
  baby("high-angle shot of the swaddled newborn sleeping on the blanket", `high-angle viewpoint from above at 45 degrees looking down, ${PORTRAIT}`, "high", "bottom"),
  baby("close-up of the newborn's sleeping face and tiny nose, cheek resting on folded hands", CLOSE, "closeup"),
  baby("macro detail of the newborn's tiny feet and toes peeking out of the blanket", MACRO, "macro"),
  baby("macro detail of the newborn's tiny hand curled around one of the small props", MACRO, "macro"),
  baby("side profile of the newborn sleeping on the tummy with the chin resting on the hands", `eye level, side profile, ${PORTRAIT}`, "profile"),
  baby("low-angle shot from blanket level, the sleeping newborn in soft focus in front with the props rising behind", `blanket-level viewpoint, low angle, ${PORTRAIT}`, "low"),
  baby("eye-level shot of the newborn sleeping on the side, wrapped, with a small plush prop tucked beside", `eye level, ${PORTRAIT}`, "eye"),
];

// 2–3 years: on their feet, walking and playing.
const TODDLER_SHOTS: ShotSpec[] = [
  baby("eye-level medium shot of the toddler standing in the middle of the set beside the main prop, looking straight at the viewer with a happy smile", `eye level, medium shot, ${PORTRAIT}`, "eye"),
  baby("wide establishing shot of the whole set with the toddler standing small in the scene among the props, full body", `eye level, wide shot, ${WIDE}`, "wide"),
  baby("high-angle shot looking down at the toddler sitting on the blanket and looking up at the viewer with wide eyes", `high-angle viewpoint from above at 45 degrees looking down, ${PORTRAIT}`, "high", "bottom"),
  baby("low-angle shot from floor level of the toddler walking toward the viewer between the props with little arms reaching out", `floor-level viewpoint, low angle, ${PORTRAIT}`, "low"),
  baby("tight close-up portrait of the toddler's face with a big cheeky grin, the props melting into soft blur behind", CLOSE, "closeup"),
  baby("detail close-up of the toddler's small hands holding one of the props", MACRO, "macro"),
  baby("over-the-shoulder view from behind the toddler, who stands looking at the props in front; the back of the head and the outfit are visible", `viewpoint just behind the toddler at the toddler's eye level, point of view, ${PORTRAIT}`, "pov"),
  baby("three-quarter side view of the toddler sitting on the main prop with the legs dangling, looking off to the side", `eye level, three-quarter angle, ${PORTRAIT}`, "profile"),
  baby("candid moment of the toddler playing with one of the props and laughing with the eyes squeezed shut", `slightly above eye level, candid, ${PORTRAIT}`, "eye"),
  baby("playful peek-a-boo moment: the toddler holds both hands up beside the face, eyes peeking out wide with delight", `eye level, ${PORTRAIT}`, "eye"),
  baby("the toddler sitting cross-legged on the blanket hugging a soft prop, smiling at the viewer", `floor-level viewpoint, ${PORTRAIT}`, "low"),
];

// 4–7 years: posed portraits and candid moments of a young child.
const KID_SHOTS: ShotSpec[] = [
  baby("eye-level medium portrait of the child standing in the middle of the set beside the main prop, smiling straight at the viewer", `eye level, medium shot, ${PORTRAIT}`, "eye"),
  baby("wide establishing shot of the whole set with the child standing in the scene among the props, full body", `eye level, wide shot, ${WIDE}`, "wide"),
  baby("high-angle shot looking down at the child sitting cross-legged on the blanket and looking up at the viewer with a bright smile", `high-angle viewpoint from above at 45 degrees looking down, ${PORTRAIT}`, "high", "bottom"),
  baby("low-angle shot from floor level of the child lying on the tummy with the chin resting in both hands, smiling at the viewer", `floor-level viewpoint, low angle, ${PORTRAIT}`, "low"),
  baby("tight close-up portrait of the child's face with a natural happy smile, the props melting into soft blur behind", CLOSE, "closeup"),
  baby("detail close-up of the child's hands holding one of the small props", MACRO, "macro"),
  baby("over-the-shoulder view from behind the child, who sits looking at the props in front; the back of the head and the outfit are visible", `viewpoint just behind the child at the child's eye level, point of view, ${PORTRAIT}`, "pov"),
  baby("three-quarter view of the child looking back over the shoulder at the viewer with a soft smile", `eye level, three-quarter angle, ${PORTRAIT}`, "profile"),
  baby("candid moment of the child laughing with the head tilted back, holding one of the props", `slightly above eye level, candid, ${PORTRAIT}`, "eye"),
  baby("side view of the child sitting on the main prop, hands resting in the lap, gazing off to the side, lost in thought", `eye level, side profile, ${PORTRAIT}`, "profile"),
  baby("the child holding one of the props close to the chest with both arms, smiling at the viewer", `eye level, medium shot, ${PORTRAIT}`, "eye"),
];

// Index 0 is the "empty set before the session" frame; it always comes first among the props shots.
const PROPS_SPECS: ShotSpec[] = [
  props("props-only shot of the empty styled set before the session: every prop in place on the smooth colored surface, close crop so the colored surface fills every edge of the frame", "eye level, close crop, 50mm lens, f/2.0, soft background falloff", "wide"),
  props("props-only flat lay photographed from directly above like a product flat lay: the outfit laid flat with the small props arranged around it on the smooth colored surface, which fills every edge of the frame", `top-down view looking straight down, close crop, ${OVERHEAD}`, "overhead"),
  props("props-only macro close-up of the single most charming prop from the props list, filling the frame, the colored background melting into soft blur", `eye level, ${MACRO}`, "macro"),
  props("props-only low-angle still life from floor level, the props in the foreground and the smooth colored background softly blurred behind, close crop", `floor-level viewpoint, low angle, close crop, ${PROPS_LENS}, creamy blurred background`, "low"),
  props("props-only detail of the folded outfit resting on the blanket next to one small prop", `slightly above, ${PROPS_LENS}, close-up, very shallow depth of field`, "closeup"),
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

export const UNIQUE_NAMES_CARDS: PackCards = {
  looks: LOOKS,
  childLooks: CHILD_LOOKS,
  newbornShare: 0.35,
  shots: { newborn: NEWBORN_SHOTS, sitter: SITTER_SHOTS, toddler: TODDLER_SHOTS, kid: KID_SHOTS },
  propsShots: PROPS_SPECS,
  ctaMoment: CTA_MOMENT,
};
