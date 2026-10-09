// Cheap, offline checks for AI name ideas (posts by letter: Suggest with AI): the page shares UNIQUE names,
// so very common ones are out, and a card's meaning must be kind. Static lists, no I/O.
import type { Gender } from "@/lib/db/types";

/**
 * Very common boy names: roughly the US top 100 (SSA, recent years), the Philippines' most common
 * baby names (PSA), and classic names every mom already knows. Not exhaustive: the prompt asks for
 * uncommon names, this catches the usual slips.
 */
export const COMMON_BOY_NAMES = [
  // US top 100
  "Liam", "Noah", "Oliver", "James", "Elijah", "Mateo", "Theodore", "Henry", "Lucas", "William", "Benjamin", "Levi",
  "Sebastian", "Jack", "Ezra", "Michael", "Daniel", "Leo", "Owen", "Samuel", "Hudson", "Alexander", "Asher", "Luca",
  "Ethan", "John", "David", "Jackson", "Joseph", "Mason", "Luke", "Matthew", "Julian", "Dylan", "Elias", "Jacob",
  "Maverick", "Gabriel", "Logan", "Aiden", "Thomas", "Isaac", "Miles", "Grayson", "Santiago", "Anthony", "Wyatt",
  "Carter", "Jayden", "Ezekiel", "Caleb", "Cooper", "Josiah", "Charles", "Christopher", "Isaiah", "Nolan", "Cameron",
  "Nathan", "Joshua", "Kai", "Waylon", "Angel", "Lincoln", "Andrew", "Roman", "Adrian", "Aaron", "Wesley", "Ian",
  "Thiago", "Axel", "Brooks", "Bennett", "Weston", "Rowan", "Christian", "Theo", "Beau", "Eli", "Silas", "Jonathan",
  "Ryan", "Leonardo", "Walker", "Jaxon", "Micah", "Everett", "Robert", "Enzo", "Parker", "Jeremiah", "Jose", "Colton",
  "Luka", "Easton", "Landon", "Jordan", "Amir", "Gael", "Austin", "Adam", "Jameson", "August", "Xavier", "Myles",
  "Dominic", "Damian", "Nicholas", "Jace", "Carson", "Atlas", "Hunter", "River", "Greyson", "Emmett", "Harrison",
  "Vincent", "Milo", "Jasper", "Jonah", "Zion", "Connor", "Sawyer", "Arthur", "Ryder", "Archer", "Lorenzo", "Oscar",
  // Philippines (PSA most common)
  "Nathaniel", "Angelo", "Mark", "Paul", "Carl", "Kenneth", "Justin", "Jerome", "Jericho", "Jhon", "Joel", "Prince",
  "Kyle", "Ivan", "Rafael", "Miguel", "Francis", "Lance", "Kian", "Clarence", "Cedric", "Ralph", "Renz", "Rhian",
  // classics everyone knows
  "Peter", "Patrick", "Richard", "Steven", "Stephen", "Kevin", "Brian", "Jason", "Eric", "Ronald", "Donald", "George",
  "Edward", "Timothy", "Gary", "Jeffrey", "Frank", "Scott", "Gregory", "Raymond", "Dennis", "Tyler", "Jesus", "Juan",
  "Carlos", "Luis", "Mario", "Pedro", "Antonio", "Manuel",
];

/** Very common girl names: the same three sources as COMMON_BOY_NAMES. */
export const COMMON_GIRL_NAMES = [
  // US top 100
  "Olivia", "Emma", "Charlotte", "Amelia", "Sophia", "Mia", "Isabella", "Ava", "Evelyn", "Luna", "Harper", "Sofia",
  "Camila", "Eleanor", "Elizabeth", "Violet", "Scarlett", "Emily", "Hazel", "Lily", "Gianna", "Aurora", "Penelope",
  "Aria", "Nora", "Chloe", "Ellie", "Mila", "Avery", "Layla", "Abigail", "Ella", "Isla", "Eliana", "Nova", "Madison",
  "Zoe", "Ivy", "Grace", "Lucy", "Willow", "Emilia", "Riley", "Naomi", "Victoria", "Stella", "Elena", "Hannah",
  "Valentina", "Maya", "Zoey", "Delilah", "Leah", "Lainey", "Lillian", "Paisley", "Genesis", "Madelyn", "Sadie",
  "Sophie", "Leilani", "Addison", "Natalie", "Josephine", "Alice", "Ruby", "Claire", "Kinsley", "Everly", "Emery",
  "Adeline", "Kennedy", "Maeve", "Audrey", "Autumn", "Athena", "Eden", "Iris", "Anna", "Eloise", "Jade", "Maria",
  "Caroline", "Brooklyn", "Quinn", "Aaliyah", "Vivian", "Liliana", "Gabriella", "Hailey", "Sarah", "Savannah", "Cora",
  "Madeline", "Natalia", "Ariana", "Lydia", "Lyla", "Clara", "Allison", "Aubrey", "Millie", "Melody", "Ayla",
  "Serenity", "Bella", "Skylar", "Josie", "Lucia", "Daisy", "Kehlani", "Kylie", "Sienna",
  // Philippines (PSA most common)
  "Althea", "Samantha", "Angel", "Princess", "Ashley", "Jasmine", "Mary", "Andrea", "Kyla", "Ayesha", "Nicole",
  "Angela", "Kristine", "Erica", "Joy", "Mae", "Alexa", "Janelle", "Bea", "Trisha", "Kate", "Jenny", "Rose",
  "Kimberly", "Angelica", "Precious",
  // classics everyone knows
  "Patricia", "Jennifer", "Linda", "Barbara", "Susan", "Jessica", "Karen", "Nancy", "Lisa", "Margaret", "Sandra",
  "Michelle", "Donna", "Dorothy", "Carol", "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Sharon", "Laura",
  "Cynthia", "Kathleen", "Katherine", "Amy", "Diana",
];

/** Names mostly given to the other gender that Gemini calls unisex (the owner flagged these). Key = the gender NOT to give it to. */
export const NOT_FOR: Record<Gender, string[]> = { boy: ["Yael"], girl: [] };

/** Not given names: brands and coinages the owner already turned down. */
export const NOT_GIVEN_NAMES = ["Yaelen", "Qiana", "Lexus", "Tesla", "Armani", "Chanel", "Gucci", "Prada", "Versace"];

const keyOf = (n: string) => n.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const setOf = (a: string[]) => new Set(a.map(keyOf));
const COMMON: Record<Gender, Set<string>> = { boy: setOf(COMMON_BOY_NAMES), girl: setOf(COMMON_GIRL_NAMES) };
const NOT_NAMES = setOf(NOT_GIVEN_NAMES);
const SLIPS: Record<Gender, Set<string>> = { boy: setOf(NOT_FOR.boy), girl: setOf(NOT_FOR.girl) };

/** Is this one of the very common names for `gender` (case- and accent-insensitive)? */
export const isCommonName = (name: string, gender: Gender) => COMMON[gender].has(keyOf(name));
/** A name mostly known for the OTHER gender: on its common list and not on this gender's, or flagged in NOT_FOR. */
export const otherGenderName = (name: string, gender: Gender) =>
  SLIPS[gender].has(keyOf(name)) || (COMMON[gender === "boy" ? "girl" : "boy"].has(keyOf(name)) && !isCommonName(name, gender));
/** A brand or coinage, not a given name. */
export const notAGivenName = (name: string) => NOT_NAMES.has(keyOf(name));

// Whole words only, so "will" or "pillar" never trip "ill" and "brave warrior" stays fine.
const NEGATIVE = new RegExp(`\\b(${[
  "wound(s|ed)?", "bitter(ness)?", "sorrow(s|ful)?", "grief", "griev(e|ed|ing)", "death", "dead(ly)?", "die[sd]?", "dying",
  "mourn(s|ed|ing|ful)?", "sad(ness)?", "pain(s|ful)?", "suffer(s|ed|ing)?", "sick(ness|ly)?", "ill(ness)?", "disease[sd]?",
  "blind", "lame", "crooked", "bald", "lazy", "weak(ling)?", "curse[sd]?", "evil", "sin(s|ful|ner)?", "slave(s|ry)?",
  "mistress", "concubine", "widow(ed)?", "orphan(ed)?", "tears", "weep(s|ing)?", "rebel(s|lion|lious)?", "wrath", "enem(y|ies)",
  "kill(s|ed|er|ing)?", "murder(s|ed|er)?", "destroy(s|ed|er)?", "ruin(s|ed)?", "doom(ed)?", "grave", "hate[sd]?", "hatred",
  "ugly", "fool(ish)?", "beggar", "lonely", "misfortune", "unlucky", "barren", "trouble[sd]?", "loss", "lost",
].join("|")})\\b`, "i");

/** Does the meaning carry a sad or harsh word (no card should say "bitter" or "wounded")? */
export const negativeMeaning = (meaning: string) => NEGATIVE.test(meaning);
