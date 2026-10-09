import type { ReelFormat } from "./formats";

// The researched topic bank (research §6.3, 52 ideas): picked when the owner leaves the topic blank. Each idea carries
// the format it suits (research tags NM / SNT / LS / SPL / PWF; the Signs list, Name Bridge and POV ideas are mapped to
// the closest of the five formats) and a health flag (fever, illness, sleep, feeding, development: the script then
// needs soft wording and a safety line).

export interface ReelTopic {
  id: string;
  topic: string;
  format: ReelFormat;
  health: boolean;
  stage?: "newborn" | "baby" | "toddler" | "preschooler";
  /** Health topics: the only medical claims the script may make (3-5 plain sentences from a checked source). */
  facts?: string[];
  /** Health topics: the safety line (when to call the doctor). */
  safety?: string;
  /** A verified term the reel may attribute to experts: "<term> — <who uses it>". */
  anchor?: string;
}

const T = (id: string, topic: string, format: ReelFormat, health = false, stage?: ReelTopic["stage"]): ReelTopic =>
  ({ id, topic, format, health, ...(stage ? { stage } : {}) });

const BASE_TOPICS: ReelTopic[] = [
  // Tantrums and big feelings
  T("five-word-rule", "The 5-Word Rule: name your toddler's big feeling in five words or less during a tantrum", "named_method", false, "toddler"),
  T("tantrum-phrases", "3 things we all say that make tantrums longer: \"calm down\", \"stop crying\", \"you're fine\"", "say_this", false, "toddler"),
  T("meltdowns-for-you", "Why your child saves the worst meltdowns for you (you're the safe place)", "problem_fix", false, "toddler"),
  T("whisper-trick", "The Whisper Trick: go quieter to get your toddler's attention", "named_method", false, "toddler"),
  T("time-out-time-in", "Time-out or time-in? What actually helps a 3-year-old reset", "lola_science", false, "preschooler"),
  T("two-choice-rule", "The 2-Choice Rule: \"red cup or blue cup?\" ends power struggles", "named_method", false, "toddler"),
  T("when-then", "When-Then: \"When shoes are on, then we go to Lola's\" instead of threats", "say_this", false, "toddler"),
  T("thrown-shoe-late", "Your toddler throws his shoe and you're late: don't say \"Stop it\"", "scene_lesson", false, "toddler"),
  // Calm instead of yelling, and repair
  T("three-step-repair", "Yelled today? The 3-Step Repair before bed: name it, own it, reconnect", "named_method", false, "preschooler"),
  T("lower-and-slower", "Lower and slower: the voice trick that calms a heated moment", "named_method", false, "toddler"),
  T("instead-of-yelling", "3 phrases to say instead of yelling", "say_this", false, "toddler"),
  T("calmer-than-you-think", "Signs you're a calmer mom than you think, even on a loud day", "problem_fix"),
  // Brain and language before 3
  T("serve-and-return", "Serve and Return: the 5-minute game that builds your baby's brain", "named_method", false, "baby"),
  T("no-flashcards", "Before age 1, babies don't need flashcards: they need your voice, your face, your arms", "lola_science", false, "baby"),
  T("rule-of-threes", "Stop saying \"Say mama!\": the Rule of Threes for first words", "say_this", false, "baby"),
  T("sportscaster-day", "The Sportscaster: narrate your day to grow your toddler's words", "named_method", false, "toddler"),
  T("screen-hours", "Pediatricians stopped counting screen hours: what they look at instead (watch with them)", "lola_science", false, "toddler"),
  T("watch-with-them", "The one screen habit linked to better language: watch with them", "problem_fix", false, "toddler"),
  T("talking-signs", "Signs your baby is learning to talk, even before the first words", "problem_fix", true, "baby"),
  // Confidence and respect
  T("labeled-praise", "Swap \"Good job!\" for labeled praise", "say_this", false, "toddler"),
  T("special-time", "Special Time: 5 minutes a day, your child leads, no questions", "named_method", false, "preschooler"),
  T("so-smart", "What your child hears when you say \"You're so smart\"", "say_this", false, "preschooler"),
  T("confident-kid", "Signs you're raising a confident kid, even if he's shy with visitors", "problem_fix", false, "preschooler"),
  T("little-helper", "Let your 3-year-old help: the small chores that build confidence", "problem_fix", false, "preschooler"),
  T("beso-or-wave", "Forced beso or mano? Offer a wave or a high-five instead", "lola_science", false, "toddler"),
  // Sleep
  T("last-three-things", "Last 3 Things: a bedtime routine that ends the stalling", "named_method", true, "toddler"),
  T("second-wind", "Why your toddler gets a second wind at 8 p.m. before sleep", "problem_fix", true, "toddler"),
  T("hamog-night-air", "Lola said: no going out at night because of hamog (night dew) and getting sick", "lola_science", true, "baby"),
  T("wet-hair-sleep", "Lola said: never let a child sleep with wet hair", "lola_science", true, "toddler"),
  // Picky eating
  T("fifteen-try-rule", "The 15-Try Rule: why a picky eater needs many tries before a new food", "named_method", true, "toddler"),
  T("who-decides", "Who decides what? Division of Responsibility at the table for picky eaters", "named_method", true, "toddler"),
  T("ubusin-mo-yan", "\"Ubusin mo 'yan!\" Why clean-plate pressure backfires (and the curly-fingers myth)", "lola_science", true, "toddler"),
  T("one-more-bite", "3 things to say at the table instead of \"Just one more bite\"", "say_this", true, "toddler"),
  // Health myths (always with a safety line)
  T("kulob-fever", "Keep it or let go: kulob to sweat out a fever", "lola_science", true, "toddler"),
  T("bathe-sick-child", "Lola said: never bathe a sick child", "lola_science", true, "toddler"),
  T("usog-saliva", "Usog and the saliva cross: what to keep (gentle boundaries with visitors) and what to let go", "lola_science", true, "baby"),
  T("haircut-smarter", "A haircut before 1 makes them smarter? Keep the keepsake, let go of the claim", "lola_science", true, "baby"),
  T("hiccup-wet-paper", "Wet paper on the forehead for baby hiccups?", "lola_science", true, "baby"),
  // Siblings
  T("turn-taking-timer", "Stop forcing \"Share!\": try turn-taking with a timer", "say_this", false, "preschooler"),
  T("sportscaster-siblings", "The Sportscaster Method for sibling fights: describe, don't judge", "named_method", false, "preschooler"),
  T("firstborn-replaced", "Signs your firstborn feels replaced by the new baby, and one fix", "problem_fix", false, "preschooler"),
  // Raising boys and girls
  T("boys-do-cry", "\"Boys don't cry\": 3 things to say instead", "say_this", false, "preschooler"),
  T("more-than-ganda", "Raising daughters: praise more than ganda (pretty)", "say_this", false, "preschooler"),
  // Money
  T("three-jar-method", "The 3-Jar Method: save, spend, share", "named_method", false, "preschooler"),
  T("choosing-not-to-buy", "Say \"We're choosing not to buy that\" instead of \"We can't afford it\"", "say_this", false, "preschooler"),
  // Discipline
  T("instead-of-palo", "What works instead of palo: 3 steps for a 4-year-old who hits", "problem_fix", false, "preschooler"),
  T("repair-rule", "Make them say sorry? Try the Repair Rule: fix it, then check on them", "named_method", false, "preschooler"),
  T("not-pasaway", "He's not pasaway, he's three: what's normal at this age", "problem_fix", false, "preschooler"),
  // Mom identity and distance
  T("good-mom-worst-day", "Signs you're a good mom, even on your worst day", "scene_lesson"),
  T("ofw-parent-thread", "The OFW parent: keeping the bond tied from far away with a daily ritual", "scene_lesson", false, "preschooler"),
  T("names-mean-brave", "3 names that mean \"brave\", and how to raise a brave kid", "named_method", false, "preschooler"),
  T("mama-poop", "You finally sit down and hear \"Mama, poop\": the potty moment, handled calmly", "scene_lesson", false, "toddler"),
];

/**
 * Vetted medical facts + a safety line for every health topic: the script may restate ONLY these as medical claims.
 * Sources (checked 2026-10-09):
 * - Fever: AAP HealthyChildren "Fever Without Fear" https://www.healthychildren.org/English/health-issues/conditions/fever/Pages/Fever-Without-Fear.aspx
 *   ("Do not overdress your child. A single layer of clothing is good."; "offer plenty of fluids"; "an alcohol bath or
 *   ice packs and sponging, are no longer recommended") and "When to Call the Pediatrician"
 *   https://www.healthychildren.org/English/health-issues/conditions/fever/Pages/When-to-Call-the-Pediatrician.aspx
 *   (under 3 months with 100.4°F / 38°C or higher: call right away; looks very ill: call right away).
 * - Sleep: HealthyChildren "Healthy Sleep Habits" https://www.healthychildren.org/English/healthy-living/sleep/Pages/healthy-sleep-habits-how-many-hours-does-your-child-need.aspx
 *   ("brush, book, bed"; the same waking time every day; screens off at least 1 hour before bedtime).
 * - Picky eating: HealthyChildren "Picky Eaters" https://www.healthychildren.org/English/ages-stages/toddler/nutrition/Pages/Picky-Eaters.aspx
 *   ("as many as 10 or more times tasting a food"; "Pressuring kids to eat ... can make them actively dislike foods";
 *   "use hunger as a guide") + Satter's Division of Responsibility (research §10.4 S3).
 * - Colds: CDC "About Common Cold" https://www.cdc.gov/common-cold/about/index.html (caused by viruses, spread by
 *   droplets and close contact).
 * - First words: CDC milestones https://www.cdc.gov/act-early/milestones/9-months.html and /1-year.html, and
 *   https://www.cdc.gov/act-early/milestones/index.html ("Don't wait." Talk with your child's doctor).
 * - Brain growth: Harvard Center on the Developing Child, serve and return (research §10.4 S3).
 * - Hiccups: Cleveland Clinic https://health.clevelandclinic.org/heres-what-to-do-when-your-baby-has-the-hiccups/
 */
const FEVER_SAFETY = "Baby under 3 months with a fever, or very sick? Call your doctor.";
const COLD_FACTS = [
  "Colds are caused by viruses, not by night air, dew or wet hair.",
  "Cold viruses spread mostly through coughs, sneezes and close contact.",
  "Washing hands often helps protect your family from germs.",
];
const SLEEP_FACTS = [
  "A simple bedtime routine, the same every night (like brush, book, bed), helps young children settle.",
  "Waking up at the same time every day helps bedtime go smoothly.",
  "Turning screens off at least an hour before bed helps children fall asleep.",
];
const SLEEP_SAFETY = "If sleep troubles go on for weeks, talk to your pediatrician.";
const EATING_FACTS = [
  "A toddler may need to taste a new food 10 or more times before accepting it.",
  "Pressuring or punishing a child to eat can make them dislike foods.",
  "You decide what, when and where food is offered; your child decides how much to eat.",
  "Children can learn to listen to their bodies and use hunger as a guide.",
];
const EATING_SAFETY = "Worried your child isn't eating enough to grow? Talk to your pediatrician.";
const HEALTH: Record<string, Pick<ReelTopic, "facts" | "safety">> = {
  "talking-signs": {
    facts: [
      "By about 9 months, many babies make lots of different sounds, like \"mamamama\" and \"bababa\".",
      "By about 1 year, many babies wave bye-bye and call a parent \"mama\", \"dada\" or another special name.",
      "Talking back and forth with your baby (serve and return) helps language grow.",
      "Every baby grows at their own pace.",
    ],
    safety: "Worried about how your baby is talking? Don't wait: ask your pediatrician.",
  },
  "last-three-things": { facts: SLEEP_FACTS, safety: SLEEP_SAFETY },
  "second-wind": {
    facts: [...SLEEP_FACTS, "A child who doesn't get enough sleep can be cranky and find it hard to settle."],
    safety: SLEEP_SAFETY,
  },
  "hamog-night-air": { facts: COLD_FACTS, safety: FEVER_SAFETY },
  "wet-hair-sleep": { facts: COLD_FACTS, safety: "Fever with trouble breathing, or very sick? Call your pediatrician." },
  "fifteen-try-rule": { facts: EATING_FACTS, safety: EATING_SAFETY },
  "who-decides": { facts: EATING_FACTS, safety: EATING_SAFETY },
  "ubusin-mo-yan": {
    facts: [...EATING_FACTS.slice(1), "Leaving food on the plate does not make fingers curl: that is only an old saying."],
    safety: EATING_SAFETY,
  },
  "one-more-bite": { facts: EATING_FACTS, safety: EATING_SAFETY },
  "kulob-fever": {
    facts: [
      "Don't bundle a child with a fever: a single light layer of clothing is good.",
      "If your child shivers or has chills, give a light blanket.",
      "Offer plenty of fluids, because a fever makes children lose fluids faster.",
      "A fever is the body fighting an infection; your goal is your child's comfort.",
    ],
    safety: FEVER_SAFETY,
  },
  "bathe-sick-child": {
    facts: [
      "A bath is fine for comfort if your child wants one: lukewarm water, never cold.",
      "Never add alcohol to the bath or rub alcohol on the skin.",
      "Sponging and ice packs are no longer recommended for a fever: aim for comfort.",
      "Offer plenty of fluids, a single light layer of clothes and rest.",
    ],
    safety: FEVER_SAFETY,
  },
  "usog-saliva": {
    facts: [
      "Washing hands before holding a baby helps protect them from germs.",
      "It's okay to ask visitors to wash their hands and let a tired baby rest.",
      "A baby who cries and can't be settled, or has a fever, needs a doctor's check.",
    ],
    safety: "Baby crying and won't settle, or has a fever? Call your pediatrician.",
  },
  "haircut-smarter": {
    facts: [
      "A haircut doesn't change how smart a child will be.",
      "Back-and-forth talk and play (serve and return) builds a baby's brain connections.",
      "Keeping a lock from the first haircut is a sweet keepsake.",
    ],
    safety: "Questions about your baby's growth? Ask your pediatrician at the next check-up.",
  },
  "hiccup-wet-paper": {
    facts: [
      "Hiccups are very common in babies and usually stop on their own.",
      "They often happen during or after feeding, when babies swallow air.",
      "Burping during feeds and feeding your baby more upright can help.",
      "A wet paper on the forehead does not stop hiccups.",
    ],
    safety: "Hiccups that go on and on, or fussy feeds? Ask your pediatrician.",
  },
};

/** Verified terms a reel may attribute to experts ("psychologists call it …"): the term, then who uses it. */
const ANCHORS: Record<string, string> = {
  "five-word-rule": "affect labeling — psychologists (naming a feeling helps it calm down)",
  "serve-and-return": "serve and return — Harvard Center on the Developing Child",
  "talking-signs": "serve and return — Harvard Center on the Developing Child",
  "haircut-smarter": "serve and return — Harvard Center on the Developing Child",
  "labeled-praise": "labeled praise — Parent-Child Interaction Therapy (PCIT)",
  "special-time": "special time — Parent-Child Interaction Therapy (PCIT)",
  "so-smart": "labeled praise — Parent-Child Interaction Therapy (PCIT)",
  "who-decides": "Division of Responsibility — Ellyn Satter, feeding specialist",
  "fifteen-try-rule": "Division of Responsibility — Ellyn Satter, feeding specialist",
  "sportscaster-day": "sportscasting — RIE (Magda Gerber's approach)",
  "sportscaster-siblings": "sportscasting — RIE (Magda Gerber's approach)",
  "screen-hours": "co-viewing — the American Academy of Pediatrics",
  "watch-with-them": "co-viewing — the American Academy of Pediatrics",
};

export const REEL_TOPICS: ReelTopic[] = BASE_TOPICS.map((t) => ({ ...t, ...(HEALTH[t.id] ?? {}), ...(ANCHORS[t.id] ? { anchor: ANCHORS[t.id] } : {}) }));

/** How many recent reels' topics are skipped. */
export const TOPIC_WINDOW = 15;

/**
 * A topic for a reel of `format`: one not used by the last 15 reels (`recentIds`), preferring the rotated format; then
 * any topic not used lately; then any topic (every one was used lately). Deterministic for a given `rng`.
 */
export function pickTopic(format: ReelFormat, recentIds: string[], rng: () => number = Math.random): ReelTopic {
  const recent = new Set(recentIds.slice(0, TOPIC_WINDOW));
  const fresh = REEL_TOPICS.filter((t) => !recent.has(t.id));
  const pool = fresh.filter((t) => t.format === format);
  const from = pool.length ? pool : fresh.length ? fresh : REEL_TOPICS;
  const r = rng();
  const i = Math.min(from.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * from.length)));
  return from[i];
}

export const topicById = (id: string | null | undefined) => REEL_TOPICS.find((t) => t.id === id) ?? null;

/** A typed topic about fever, illness, sleep safety, choking, allergies or medicine: the script gets the health rules. */
const HEALTH_WORDS = /\b(?:fever|feverish|cough\w*|vomit\w*|throw(?:s|ing)? up|rash\w*|diarrh\w*|sick|illness|sleep safety|safe sleep|sids|chok\w*|allerg\w*|medicine\w*|medication\w*|dose|teething pain|dehydrat\w*)\b/i;
export const isHealthTopic = (topic: string | null | undefined) => HEALTH_WORDS.test(topic ?? "");
