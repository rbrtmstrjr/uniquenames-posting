import type { ReelFormat } from "./formats";

// The researched topic bank (research §6.3; reworked for a global audience on 2026-10-10, 57 ideas): picked when the owner
// leaves the topic blank. Each idea carries the format it suits (research tags NM / SNT / LS / SPL / PWF; the Signs list,
// Name Bridge and POV ideas are mapped to the closest of the five formats) and a health flag (fever, illness, sleep,
// feeding, development: the script then needs soft wording and a safety line). Every topic, fact and anchor is in simple
// English anyone understands: no Filipino / Tagalog words and no expert jargon (lib/ai/plain-words).

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
  /** A plain-language anchor the reel may restate: "<plain claim> — <who says it>" (never a technique or study name). */
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
  T("when-then", "When-Then: \"When shoes are on, then we go to the park\" instead of threats", "say_this", false, "toddler"),
  T("thrown-shoe-late", "Your toddler throws his shoe and you're late: don't say \"Stop it\"", "scene_lesson", false, "toddler"),
  // Calm instead of yelling, and repair
  T("three-step-repair", "Yelled today? The 3-Step Repair before bed: name it, own it, reconnect", "named_method", false, "preschooler"),
  T("lower-and-slower", "Lower and slower: the voice trick that calms a heated moment", "named_method", false, "toddler"),
  T("instead-of-yelling", "3 phrases to say instead of yelling", "say_this", false, "toddler"),
  T("calmer-than-you-think", "Signs you're a calmer mom than you think, even on a loud day", "problem_fix"),
  // Brain and language before 3
  T("back-and-forth-game", "The Back-and-Forth Game: 5 minutes a day that grow your baby's brain", "named_method", false, "baby"),
  T("no-flashcards", "Before age 1, babies don't need flashcards: they need your voice, your face, your arms", "lola_science", false, "baby"),
  T("rule-of-threes", "Stop saying \"Say mama!\": the Rule of Threes for first words", "say_this", false, "baby"),
  T("sportscaster-day", "The Sportscaster: say what your toddler is doing to grow his words", "named_method", false, "toddler"),
  T("screen-hours", "Pediatricians stopped counting screen hours: what they look at instead (watch with them)", "lola_science", false, "toddler"),
  T("watch-with-them", "The one screen habit that helps kids talk more: watch with them", "problem_fix", false, "toddler"),
  T("talking-signs", "Signs your baby is learning to talk, even before the first words", "problem_fix", true, "baby"),
  // Confidence and respect
  T("labeled-praise", "Swap \"Good job!\" for praise that names exactly what your child did", "say_this", false, "toddler"),
  T("special-time", "Special Time: 5 minutes a day, your child leads, no questions", "named_method", false, "preschooler"),
  T("so-smart", "What your child hears when you say \"You're so smart\"", "say_this", false, "preschooler"),
  T("confident-kid", "Signs you're raising a confident kid, even if he's shy with visitors", "problem_fix", false, "preschooler"),
  T("little-helper", "Let your 3-year-old help: the small chores that build confidence", "problem_fix", false, "preschooler"),
  T("forced-hugs", "Make them hug Grandma goodbye? Offer a wave or a high-five instead", "lola_science", false, "toddler"),
  // Sleep
  T("last-three-things", "Last 3 Things: a bedtime routine that ends the stalling", "named_method", true, "toddler"),
  T("second-wind", "Why your toddler gets a second wind at 8 p.m. before sleep", "problem_fix", true, "toddler"),
  // Picky eating
  T("fifteen-try-rule", "The 15-Try Rule: why a picky eater needs many tries before a new food", "named_method", true, "toddler"),
  T("who-decides", "Who decides what at the table? You pick the food, your child picks how much", "named_method", true, "toddler"),
  T("clean-plate", "Grandma said: clean your plate. Why pushing \"one more bite\" backfires", "lola_science", true, "toddler"),
  T("one-more-bite", "3 things to say at the table instead of \"Just one more bite\"", "say_this", true, "toddler"),
  // Grandma said, science says: old wives' tales known in many countries (always with vetted facts and a safety line)
  T("sweat-out-fever", "Grandma said: bundle up a fever and sweat it out", "lola_science", true, "toddler"),
  T("bathe-sick-child", "Grandma said: never bathe a sick child", "lola_science", true, "toddler"),
  T("wet-hair-cold", "Grandma said: going out with wet hair gives you a cold", "lola_science", true, "toddler"),
  T("feed-cold-starve-fever", "Grandma said: feed a cold, starve a fever", "lola_science", true, "toddler"),
  T("cereal-in-bottle", "Grandma said: rice cereal in the bottle helps baby sleep through the night", "lola_science", true, "baby"),
  T("teething-fever", "Grandma said: teething causes high fevers", "lola_science", true, "baby"),
  T("baby-walkers", "Grandma said: a baby walker helps babies walk sooner", "lola_science", true, "baby"),
  T("bottle-in-bed", "Grandma said: putting baby to bed with a bottle is fine", "lola_science", true, "baby"),
  T("honey-for-babies", "Grandma said: a little honey is fine for babies", "lola_science", true, "baby"),
  // Siblings
  T("turn-taking-timer", "Stop forcing \"Share!\": try turn-taking with a timer", "say_this", false, "preschooler"),
  T("sportscaster-siblings", "The Sportscaster Method for sibling fights: describe, don't judge", "named_method", false, "preschooler"),
  T("firstborn-replaced", "Signs your firstborn feels replaced by the new baby, and one fix", "problem_fix", false, "preschooler"),
  // Raising boys and girls
  T("boys-do-cry", "\"Boys don't cry\": 3 things to say instead", "say_this", false, "preschooler"),
  T("more-than-pretty", "Raising daughters: praise more than \"pretty\"", "say_this", false, "preschooler"),
  // Money
  T("three-jar-method", "The 3-Jar Method: save, spend, share", "named_method", false, "preschooler"),
  T("choosing-not-to-buy", "Say \"We're choosing not to buy that\" instead of \"We can't afford it\"", "say_this", false, "preschooler"),
  // Discipline
  T("instead-of-spanking", "What works instead of spanking: 3 steps for a 4-year-old who hits", "problem_fix", false, "preschooler"),
  T("repair-rule", "Make them say sorry? Try the Repair Rule: fix it, then check on them", "named_method", false, "preschooler"),
  T("not-naughty", "He's not naughty, he's three: what's normal at this age", "problem_fix", false, "preschooler"),
  // Mom identity, and a parent far away
  T("good-mom-worst-day", "Signs you're a good mom, even on your worst day", "scene_lesson"),
  T("parent-abroad", "A parent working abroad: a daily ritual that keeps your child close from far away", "scene_lesson", false, "preschooler"),
  T("away-parent-ritual", "The parent who travels for work: a goodbye ritual that makes leaving easier", "scene_lesson", false, "preschooler"),
  T("military-deployment", "Mom or Dad is deployed: a goodnight ritual that keeps your little one close", "scene_lesson", false, "preschooler"),
  T("long-distance-coparent", "Long-distance co-parenting: a weekly video-call ritual for a child in another city", "scene_lesson", false, "preschooler"),
  T("names-mean-brave", "3 names that mean \"brave\", and how to raise a brave kid", "named_method", false, "preschooler"),
  T("mommy-poop", "You finally sit down and hear \"Mommy, I have to poop!\": the potty moment, handled calmly", "scene_lesson", false, "toddler"),
];

/**
 * Vetted medical facts + a safety line for every health topic: the script may restate ONLY these as medical claims.
 * Sources (checked 2026-10-09; the Grandma-said myths checked 2026-10-10):
 * - Fever: AAP HealthyChildren "Fever Without Fear" https://www.healthychildren.org/English/health-issues/conditions/fever/Pages/Fever-Without-Fear.aspx
 *   ("Do not overdress your child. A single layer of clothing is good."; "If your child is shivering or has the chills,
 *   give them a blanket."; "offer plenty of fluids to avoid dehydration"; "an alcohol bath or ice packs and sponging,
 *   are no longer recommended") and "When to Call the Pediatrician"
 *   https://www.healthychildren.org/English/health-issues/conditions/fever/Pages/When-to-Call-the-Pediatrician.aspx
 *   (under 3 months with 100.4°F / 38°C or higher: call right away; looks very ill: call right away).
 * - Colds: CDC "About Common Cold" https://www.cdc.gov/common-cold/about/index.html (caused by viruses, spread by
 *   droplets from coughs and sneezes and by close contact); HealthyChildren "Children and Colds"
 *   https://www.healthychildren.org/English/health-issues/conditions/ear-nose-throat/Pages/Children-and-Colds.aspx
 *   ("Colds are caused by viruses"; "plenty of rest and drinks a lot of fluids"; "Not wanting to eat" is a symptom;
 *   "3 months or younger, call the pediatrician at the first sign of illness"); CDC "About Handwashing"
 *   https://www.cdc.gov/clean-hands/about/index.html ("Washing hands can ... prevent the spread of respiratory ... infections").
 * - Cereal in a bottle: HealthyChildren "Starting Solid Foods" https://www.healthychildren.org/English/ages-stages/baby/feeding-nutrition/Pages/Starting-Solid-Foods.aspx
 *   ("Do not put baby cereal in a bottle because your baby could choke."; "can cause your baby to gain too much
 *   weight"; "may be recommended if your baby has reflux") and "Getting Your Baby to Sleep"
 *   https://www.healthychildren.org/English/ages-stages/baby/sleep/Pages/Getting-Your-Baby-to-Sleep.aspx ("Put babies to bed when they are drowsy.").
 * - Teething: HealthyChildren "Teething: 4 to 7 Months" https://www.healthychildren.org/English/ages-stages/baby/teething-tooth-care/Pages/Teething-4-to-7-Months.aspx
 *   ("a slight rise in temperature (but not over 101 degrees Fahrenheit)"; "higher than 101 ... it's probably not from
 *   teething"; rub the gums with a finger; firm rubber teething rings; frozen teethers "get too hard").
 * - Walkers: HealthyChildren "Baby Walkers: A Dangerous Choice" https://www.healthychildren.org/English/safety-prevention/at-home/Pages/Baby-Walkers-A-Dangerous-Choice.aspx
 *   ("walkers can actually delay when a child starts to walk"; "never safe to use, even with an adult close by";
 *   stairs, burns; activity centers with no wheels and play yards are safer).
 * - Bottle in bed: HealthyChildren "How to Prevent Tooth Decay in Your Baby" https://www.healthychildren.org/English/ages-stages/baby/teething-tooth-care/Pages/How-to-Prevent-Tooth-Decay-in-Your-Baby.aspx
 *   ("No bottles in bed."; "Even the natural sugars in breast milk and formula can kick-start the process of tooth
 *   decay."; milk at mealtimes, plain water in between; wipe the gums with a clean, damp washcloth after each feeding).
 * - Honey: CDC "Preventing Botulism" https://www.cdc.gov/botulism/prevention/index.html ("Do not feed honey to a child
 *   who is younger than 1 year old."; "Honey can contain the bacteria that cause botulism."; no honey pacifiers).
 * - Sleep: HealthyChildren "Healthy Sleep Habits" https://www.healthychildren.org/English/healthy-living/sleep/Pages/healthy-sleep-habits-how-many-hours-does-your-child-need.aspx
 *   ("brush, book, bed"; the same waking time every day; screens off at least 1 hour before bedtime).
 * - Picky eating: HealthyChildren "Picky Eaters" https://www.healthychildren.org/English/ages-stages/toddler/nutrition/Pages/Picky-Eaters.aspx
 *   ("as many as 10 or more times tasting a food"; "Pressuring kids to eat ... can make them actively dislike foods";
 *   "use hunger as a guide") + feeding expert Ellyn Satter's "you decide what, your child decides how much" (research §10.4 S3).
 * - First words: CDC milestones https://www.cdc.gov/act-early/milestones/9-months.html and /1-year.html, and
 *   https://www.cdc.gov/act-early/milestones/index.html ("Don't wait." Talk with your child's doctor).
 */
const FEVER_SAFETY = "Baby under 3 months with a fever, or very sick? Call your doctor.";
const COLD_FACTS = [
  "Colds are caused by viruses, not by wet hair or cold air.",
  "Cold viruses spread mostly through coughs, sneezes and close contact.",
  "Washing hands often helps stop colds and other germs from spreading.",
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
      "Talking back and forth with your baby helps language grow.",
      "Every baby grows at their own pace.",
    ],
    safety: "Worried about how your baby is talking? Don't wait: ask your pediatrician.",
  },
  "last-three-things": { facts: SLEEP_FACTS, safety: SLEEP_SAFETY },
  "second-wind": {
    facts: [...SLEEP_FACTS, "A child who doesn't get enough sleep can be cranky and find it hard to settle."],
    safety: SLEEP_SAFETY,
  },
  "fifteen-try-rule": { facts: EATING_FACTS, safety: EATING_SAFETY },
  "who-decides": { facts: EATING_FACTS, safety: EATING_SAFETY },
  "clean-plate": { facts: EATING_FACTS, safety: EATING_SAFETY },
  "one-more-bite": { facts: EATING_FACTS, safety: EATING_SAFETY },
  "sweat-out-fever": {
    facts: [
      "Don't bundle a child with a fever: a single light layer of clothing is good.",
      "If your child shivers or has chills, give a light blanket.",
      "Offer plenty of fluids so your child doesn't get dehydrated.",
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
  "wet-hair-cold": { facts: COLD_FACTS, safety: "Fever with trouble breathing, or very sick? Call your pediatrician." },
  "feed-cold-starve-fever": {
    facts: [
      "Colds are caused by viruses.",
      "With a cold, make sure your child gets plenty of rest and lots of fluids.",
      "With a fever, offer plenty of fluids so your child doesn't get dehydrated.",
      "Not wanting to eat is common when a child has a cold.",
    ],
    safety: "Baby 3 months or younger and sick? Call your pediatrician right away.",
  },
  "cereal-in-bottle": {
    facts: [
      "Don't put baby cereal in a bottle: your baby could choke.",
      "Cereal in a bottle can make your baby eat too much and gain too much weight.",
      "Only add cereal to a bottle if your pediatrician tells you to (for example, for reflux).",
      "Put your baby to bed when they are drowsy.",
    ],
    safety: "Worried about your baby's sleep or feeding? Talk to your pediatrician.",
  },
  "teething-fever": {
    facts: [
      "Teething may cause a slight rise in temperature, but not over 101°F.",
      "A fever over 101°F is probably not from teething.",
      "Gently rubbing your baby's gums with a clean finger can help.",
      "A firm rubber teething ring can help; frozen teethers can get too hard.",
    ],
    safety: "Fever over 101°F, or your baby seems really miserable? Call your pediatrician.",
  },
  "baby-walkers": {
    facts: [
      "Baby walkers don't help babies learn to walk; they can even delay walking.",
      "Walkers are never safe, even with an adult close by: babies can roll down stairs or reach hot things.",
      "An activity center with no wheels, or a play yard, is a safer choice.",
    ],
    safety: "Questions about how your baby is moving or walking? Ask your pediatrician.",
  },
  "bottle-in-bed": {
    facts: [
      "No bottles in bed: milk left on the teeth can lead to cavities.",
      "Even the natural sugars in breast milk and formula can start tooth decay.",
      "Offer milk at mealtimes and plain water in between.",
      "Wipe your baby's gums with a clean, damp washcloth after each feeding.",
    ],
    safety: "Questions about your baby's teeth? Ask your pediatrician or dentist.",
  },
  "honey-for-babies": {
    facts: [
      "Honey is not safe for babies younger than 1 year old, not even a little.",
      "Honey can contain germs that make babies sick.",
      "Never dip a pacifier in honey, and skip honey pacifiers.",
      "After the first birthday, honey is fine.",
    ],
    safety: "Questions about what your baby can eat? Ask your pediatrician.",
  },
};

/** Plain-language anchors a reel may restate (never a technique or study name): "<plain claim> — <who says it>". */
const FEELING_ANCHOR = "naming the feeling out loud helps a child calm down — child experts";
const TALK_ANCHOR = "talking back and forth with your baby helps their brain and words grow — child development experts";
const PRAISE_ANCHOR = "praise that names exactly what your child did helps them do it again — child psychologists";
const FEEDING_ANCHOR = "you decide what, when and where food is served; your child decides how much — feeding experts";
const SAY_WHAT_YOU_SEE = "saying out loud what your child is doing, without judging, helps them feel seen — child experts";
const SCREEN_ANCHOR = "watching together and talking about the show matters more than counting hours — the American Academy of Pediatrics";
const ANCHORS: Record<string, string> = {
  "five-word-rule": FEELING_ANCHOR,
  "back-and-forth-game": TALK_ANCHOR,
  "talking-signs": TALK_ANCHOR,
  "labeled-praise": PRAISE_ANCHOR,
  "so-smart": PRAISE_ANCHOR,
  "special-time": "a few minutes a day of play your child leads can help behavior — child psychologists",
  "who-decides": FEEDING_ANCHOR,
  "fifteen-try-rule": FEEDING_ANCHOR,
  "sportscaster-day": SAY_WHAT_YOU_SEE,
  "sportscaster-siblings": SAY_WHAT_YOU_SEE,
  "screen-hours": SCREEN_ANCHOR,
  "watch-with-them": SCREEN_ANCHOR,
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
