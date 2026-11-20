// The photo check's problem ids (the Claude schema's enum), their plain labels, and strict parsing.
export const PHOTO_PROBLEMS = ["hands", "feet", "face", "soles", "skin", "split", "text", "name_on_face", "extra_person", "other"] as const;
export type PhotoProblem = (typeof PHOTO_PROBLEMS)[number];
export const PROBLEM_LABEL: Record<PhotoProblem, string> = {
  hands: "odd hands or fingers", feet: "odd feet or toes", face: "warped face or eyes", soles: "soles to the camera",
  skin: "too much skin", split: "split or collage frame", text: "text in the photo", name_on_face: "name covers the face",
  extra_person: "extra baby or body part", other: "something looks wrong",
};
export interface PhotoVerdict { pass: boolean; problems: PhotoProblem[]; note: string }

/** A pass that names problems is a fail; unknown problems drop; a fail without a known problem is "other". */
export function parsePhotoVerdict(raw: unknown): PhotoVerdict | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pass !== "boolean" || !Array.isArray(r.problems)) return null;
  const problems = [...new Set(r.problems.filter((p): p is PhotoProblem => typeof p === "string" && (PHOTO_PROBLEMS as readonly string[]).includes(p)))];
  const note = typeof r.note === "string" ? r.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (r.pass && !r.problems.length) return { pass: true, problems: [], note };
  return { pass: false, problems: problems.length ? problems : ["other"], note };
}

/** The later card of each look-alike pair: whole numbers 2..count, each once, at most 3. */
export function parseLookAlike(raw: unknown, count: number): number[] | null {
  const list = raw && typeof raw === "object" ? (raw as { remake?: unknown }).remake : null;
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter((n): n is number => Number.isInteger(n) && n >= 2 && n <= count))].slice(0, 3);
}
