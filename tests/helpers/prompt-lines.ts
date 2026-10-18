// Card prompt lines for tests. Story prompts (2026-10-18) lead with the frame, so the child is found by its line, not
// by position; hands, detail and still-life frames have no child line at all.

/** The "Subject…" line of a face frame (portrait or story), or undefined. */
export const subjectOf = (prompt: string) => prompt.split("\n").find((l) => l.startsWith("Subject"));

/** The line that names the child's age: a face frame's subject line or a focus pull's "Out of focus behind it" line. */
export const childOf = (prompt: string) => prompt.split("\n").find((l) => l.startsWith("Subject") || l.startsWith("Out of focus behind it"));

/** The child's age in a child line: "newborn" or "N-year-old" (undefined for a line without an age). */
export const ageIn = (line: string) => /newborn|\d-year-old|8-month-old/.exec(line)?.[0];
