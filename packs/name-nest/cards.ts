import type { PackCards } from "../types";
import { UNIQUE_NAMES_CARDS } from "../unique-names/cards";

// Name Nest name cards: varied American babies and kids. One look is picked per post (deterministic per post, so the
// same child in every photo of a fixed-age post) and the looks rotate across White, Black, Hispanic / Latino, Asian
// American, South Asian American and mixed-heritage children. The shot lists and the closing card's moment are the
// photoshoot grammar shared with the engine (camera words only, no page text), so they are reused as they are.

// Babies (newborn, 1 year); the same index in CHILD_LOOKS is the same child at 2 and up.
const LOOKS = [
  "soft wispy light-blond hair, fair skin and big blue eyes",
  "soft tight dark curls, deep brown skin and big dark-brown eyes",
  "soft dark-brown hair, warm olive-tan skin and big brown eyes",
  "fine straight black hair, light golden skin and dark almond-shaped eyes",
  "soft light-brown curls, warm golden-brown skin and hazel eyes",
  "thick soft black hair, warm medium-brown skin and long dark eyelashes",
  "fine strawberry-blond hair, fair skin and light-blue eyes",
  "short soft black coils, warm medium-brown skin and bright dark eyes",
  "wavy chestnut-brown hair, light olive skin and warm brown eyes",
  "soft brown hair, fair skin and big gray-green eyes",
];
// No "rosy": on older children the model paints it as round red blush spots.
const CHILD_LOOKS = [
  "light-blond hair, fair skin and big blue eyes",
  "dark curly hair, deep brown skin and big dark-brown eyes",
  "dark-brown hair, warm olive-tan skin and big brown eyes",
  "straight black hair, light golden skin and dark almond-shaped eyes",
  "light-brown curls, warm golden-brown skin and hazel eyes",
  "thick black hair, warm medium-brown skin and long dark eyelashes",
  "strawberry-blond hair, fair skin with light freckles and light-blue eyes",
  "short black coils, warm medium-brown skin and bright dark eyes",
  "wavy chestnut-brown hair, light olive skin and warm brown eyes",
  "brown hair, fair skin and big gray-green eyes",
];

export const NAME_NEST_CARDS: PackCards = {
  looks: LOOKS,
  childLooks: CHILD_LOOKS,
  newbornShare: 0.35,
  shots: UNIQUE_NAMES_CARDS.shots,
  propsShots: UNIQUE_NAMES_CARDS.propsShots,
  ctaMoment: UNIQUE_NAMES_CARDS.ctaMoment,
};
