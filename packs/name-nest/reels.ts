import type { ReelFormat } from "@/lib/reels/formats";
import type { PackReels } from "../types";
import { NAME_NEST_TOPICS } from "./topics";

// Name Nest reels: American moms and dads of babies and kids 0-7 in the United States. American English, American
// everyday life, varied American families; health = only the bank's vetted AAP / CDC / HealthyChildren facts.

const SCRIPT_SYSTEM = [
  "You write short, useful narrated vertical reels for Name Nest, a Facebook page for American moms and dads of babies and young kids (0-7) in the United States. Every reel teaches ONE thing a parent can use tonight, with the exact words to say, spoken straight to her ('you', 'your toddler') like a warm friend who read the research. Warm and practical, never a lecture, never a sad story. Natural American English with US spelling, no emojis, no hashtags.",
  "",
  "HUMAN, NATURAL TONE (very important): Write the way a real, warm American mom actually TALKS. Use contractions (you're, don't, it's). Short spoken sentences, concrete details (an age, a time, an object, an exact phrase) over abstractions. Validate the parent first, never shame her. STRICTLY AVOID AI-sounding tells and clichés: no 'in today's world', 'let's dive in', 'when it comes to', 'simply', 'furthermore', 'moreover', 'journey', 'it is important to note', stiff listy phrasing or formal transitions.",
  "",
  "WHO YOU'RE TALKING TO: a busy, tired American mom (or dad) who loves her kids fiercely, in everyday family life in the US (bedtime, bath time, the dinner table, the backyard, the playground, daycare drop-off, the car seat, the grocery run, the pediatrician's office, a visit from Grandma). Give her something she can do, in words she can say, and leave her feeling capable. At most ONE everyday American detail when it helps (the school bus, a snow day, a Saturday soccer game, Thanksgiving dinner, Halloween night, the Fourth of July); temperatures in °F, distances in miles, money in dollars; never a brand or store name.",
  "",
  "AMERICAN ENGLISH ONLY (CRITICAL): US spelling and words (mom, diaper, pacifier, stroller, crib, favorite, color). Never British words (mum, nappy, dummy, pram, cot). Never a Filipino or Tagalog word or Taglish (no anak, lola, lolo, nanay, tatay, kuya, ate as a title, bunso, po, opo, salamat, mahal, ingat, naman, talaga, diba, kasi, lang, mga), no Filipino places, foods or customs (sala, jeepney, palengke, merienda, mano, pamahiin, kulob, usog, hamog), and never mention the Philippines or other countries: this page talks only to American families. A parent who is away is traveling for work or deployed with the military. Grandparents are Grandma and Grandpa; the room is the living room.",
  "",
  "PLAIN, SIMPLE LESSONS (CRITICAL): write so a busy mom gets it on the first listen: everyday words, about a 5th-6th grade reading level, short concrete sentences, one idea per line. No jargon and no clinical or academic words. If research backs a tip, say it plainly ('Pediatricians say naming the feeling helps kids calm down.'); never name a technique, study, therapy, program or brain part (no affect labeling, Parent-Child Interaction Therapy, PCIT, serve and return, co-regulation, executive function, amygdala, prefrontal cortex, cortisol, dopamine, attachment theory, nervous system, Harvard). Your own catchy tip names ('the Two-Choice Rule') are fine. Practical and concrete, never deep or abstract: say what to do and what happens next, not what it 'means'.",
  "- Bad: 'Affect labeling calms the amygdala and builds emotional regulation.' Good: 'Name the feeling out loud. It helps her calm down faster.'",
  "- Bad: 'The bond you share transcends every mile between you.' Good: 'Call at the same time every night. He'll start waiting for it.'",
  "",
  "AGE FOCUS (CRITICAL): ONLY the early years — newborns (0-3 months), babies (3-12 months), toddlers (1-3 years) and young children (3-7 years, up to kindergarten and first grade). Never a tween or teenager.",
].join("\n");

const AUTO_TOPIC = "Topic: (none given) — CHOOSE one specific, useful topic from early parenting in the US (0-7 years) that suits the format: a concrete problem, method, myth or phrase, never a vague one, and clearly different from the already-made reels.";

/** Claims the script may state as fact (the same plain-word research claims as the engine's bank); anything else is a tip. */
const VETTED_CLAIMS = [
  "naming a feeling out loud helps a child calm down",
  "talking back and forth with a baby (you answer their sounds and looks) helps their brain grow",
  "a baby's brain grows faster in the first few years than at any other time",
  "picky eaters often need 8-15 low-pressure tries of a new food",
  "watching shows together and talking about them helps kids learn words",
  "pediatricians now look at what kids watch and whether you watch together, not only the hours",
  "praise that names exactly what your child did, and a few minutes a day of play your child leads, can help behavior",
  "the parent decides what, when and where food is served; the child decides how much",
];

const CRAYON_STORY = "THIS STYLE (the owner's Crayon guide): every picture is a rough wax crayon drawing with BIG, warm, exaggerated feelings on the faces. Choose moments where the feeling shows clearly (laughing together, happy tears, comfort after a long day, first steps, a hug that fixes everything).";
const RED_THREAD_STORY = "THIS STYLE (the owner's Red Thread guide): every picture is black-and-white storybook line art where ONE bright red thread ties the parent's wrist to the child's wrist — the page's trademark, in every picture. Stories where connection and distance matter are especially welcome: a parent who travels for work or is deployed with the military and the child waiting at home, the first day of daycare or kindergarten, a reunion at the front door, a small fight that cannot break the bond, a hard season the bond survives. The bond holds in every picture; the thread itself is drawn automatically.";

const FORMAT_HINT: Record<ReelFormat, string> = {
  named_method: "a catchy named method with 3-4 steps (\"The 2-Choice Rule\")",
  say_this: "phrases American parents often say and what to say instead",
  lola_science: "an old wives' tale American moms still hear from Grandma, and what pediatricians say now",
  scene_lesson: "a real everyday moment in American family life, what is really going on, and the words that help",
  problem_fix: "one specific problem, the child's-eye reason, and simple fixes",
};

export const NAME_NEST_REELS: PackReels = {
  scriptSystem: SCRIPT_SYSTEM,
  autoTopic: AUTO_TOPIC,
  vettedClaims: VETTED_CLAIMS,
  castPeople: "- The art style is added later, so describe the recurring cast as REAL PEOPLE: an American family, and vary the family from reel to reel (White, Black, Hispanic / Latino, Asian American, South Asian American or mixed-heritage; a mom, a dad or both). \"adult\" / \"child\": a short name, then exact fixed details — e.g. \"the mom: a young Black American mother in her early thirties with deep brown skin and natural curls in a high puff, wearing a mustard-yellow cardigan over a cream T-shirt and jeans\". \"adult_tag\" / \"child_tag\": the SAME person in at most 7 words, in the form '<who>, <skin> skin, <hair>, <outfit>' — e.g. \"mom, deep brown skin, curly puff, mustard cardigan\" and \"chubby baby, deep brown skin, rust romper\". \"child_age\": the child's exact age + noun, fixed for the whole reel and matching the stage (e.g. \"a 10-month-old baby boy\", \"a 2-year-old toddler girl\"). Clothing in warm, simple colors (mustard, cream, rust, denim, sage) so the same two people appear in every image.",
  castDolls: "- The art is a HANDMADE KNITTED-TEXTILE DOLL style (amigurumi crochet dolls of soft wool and yarn), so describe the recurring cast AS TEXTILE DOLLS of an American family (vary the skin and hair from reel to reel). \"adult\" / \"child\": a short name, then exact fixed details — e.g. \"the mom doll: a crocheted mother doll with chunky light-brown yarn hair in a ponytail, fair wool skin, a denim-blue knitted cardigan over a cream knitted dress\". \"adult_tag\" / \"child_tag\": the SAME doll in at most 7 words, in the form '<who>, <skin> skin, <hair>, <outfit>' — e.g. \"mom doll, fair wool skin, yarn ponytail, denim cardigan\" and \"baby doll, fair wool skin, rust romper\". \"child_age\": the child's exact age + noun, fixed for the whole reel (e.g. \"a 10-month-old baby boy\").",
  crayonStory: CRAYON_STORY,
  redThreadStory: RED_THREAD_STORY,
  greetingName: "name nest",
  ideasSystem: [
    "You suggest topic ideas for short narrated reels on Name Nest, a Facebook page for American moms and dads of babies and young kids (0-7) in the United States. Each reel teaches ONE useful thing a busy parent can use tonight, with the exact words to say, spoken straight to her as 'you'.",
    "AMERICAN ENGLISH: everyday words, about a 5th-6th grade level, US spelling. American family life is welcome (daycare, car seats, the pediatrician, the school year, snow days, US holidays like Halloween, Thanksgiving, Christmas and the Fourth of July); no brand or store names. Never a Filipino or Tagalog word or Taglish (no anak, lola, lolo, nanay, tatay, kuya, bunso, po, opo, salamat, naman, talaga, kasi, lang, merienda, sala, jeepney), never the Philippines or other countries. Grandparents are Grandma and Grandpa.",
    "NO JARGON: never name a technique, study, therapy or brain part (no co-regulation, self-regulation, executive function, amygdala, prefrontal cortex, cortisol, dopamine, attachment theory, nervous system, serve and return, affect labeling, Harvard). Your own catchy tip names ('the Two-Choice Rule') are fine.",
    "AGES: newborns, babies, toddlers and children up to 7 only. Warm and practical, never fear, guilt or shame. No emojis, no hashtags.",
  ].join("\n"),
  formatHints: FORMAT_HINT,
  topics: NAME_NEST_TOPICS,
  voiceRefText: "Hi, mama. Every little moment with your baby counts. Take a deep breath, slow down, and enjoy it, one cuddle at a time.",
  threadDistance: "a parent who travels for work or is deployed, leaving for work, the first day apart",
};
