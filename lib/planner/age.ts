// The child's age, chosen per post on Today. "random" (the default) gives every baby card its
// own child, with the ages dealt so a post shows a real spread; a fixed age is one child for
// the whole post. Owner: "limit it to 7 years old max".
export const SUBJECT_AGES = ["newborn", "1", "2", "3", "4", "5", "6", "7"] as const;
export type SubjectAge = (typeof SUBJECT_AGES)[number];
export const AGE_CHOICES = ["random", ...SUBJECT_AGES] as const;
export type AgeChoice = (typeof AGE_CHOICES)[number];

export const isAgeChoice = (v: unknown): v is AgeChoice => typeof v === "string" && (AGE_CHOICES as readonly string[]).includes(v);

/** Labels for the Today Select. */
export const AGE_LABELS: Record<AgeChoice, string> = {
  random: "Random (newborn–7)", newborn: "Newborn", "1": "1 year",
  "2": "2 years", "3": "3 years", "4": "4 years", "5": "5 years", "6": "6 years", "7": "7 years",
};

/** A post row's stored subject_age as a choice; null/unknown = a post made before ages existed. */
export const storedAge = (v: unknown): AgeChoice | null => (isAgeChoice(v) ? v : null);
