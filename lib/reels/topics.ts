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
}

const T = (id: string, topic: string, format: ReelFormat, health = false, stage?: ReelTopic["stage"]): ReelTopic =>
  ({ id, topic, format, health, ...(stage ? { stage } : {}) });

export const REEL_TOPICS: ReelTopic[] = [
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
