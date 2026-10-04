"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Gender, NameStyle } from "@/lib/db/types";
import { validateName } from "./validate";
import { dedupeNames, nameKey, normalizeName, styleOf } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

// `style` is accepted for caller convenience but always derived from the name itself.
export async function addNamesAction(rows: { name: string; meaning: string; gender: Gender; style?: NameStyle }[]): Promise<ActionResult<{ added: number; skipped: string[] }>> {
  await requireOwner();
  if (!rows.length) return fail("Nothing to add.");
  if (rows.length > 1000) return fail("Add at most 1000 names at a time.");
  for (const r of rows) { const bad = validateName(r.name, r.meaning); if (bad) return fail(`${r.name}: ${bad}`); }
  const sb = await createClient();
  // Only look up the incoming names (a full-table select is capped at 1000 rows).
  const keys = [...new Set(rows.map((r) => nameKey(r.name)))];
  const have = new Set<string>();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const { data: hit, error: qe } = await sb.from("names").select("name").or(chunk.map((k) => `name.ilike."${k}"`).join(","));
    if (qe) return fail(qe.message);
    for (const h of hit ?? []) have.add(nameKey(h.name as string));
  }
  const { fresh: picked, skipped } = dedupeNames(rows, have);
  const fresh = picked.map((r) => ({ name: normalizeName(r.name), meaning: r.meaning.trim().toLowerCase(), gender: r.gender, style: styleOf(r.name) }));
  if (fresh.length) {
    const { error } = await sb.from("names").insert(fresh);
    if (error) return fail(error.message.includes("names_lower_name") ? "Some names were added at the same time. Try again." : error.message);
  }
  revalidatePath("/names");
  revalidatePath("/");
  return { ok: true, added: fresh.length, skipped };
}

export async function updateNameAction(id: string, v: { name: string; meaning: string; gender: Gender }): Promise<ActionResult> {
  await requireOwner();
  const bad = validateName(v.name, v.meaning);
  if (bad) return fail(bad);
  const sb = await createClient();
  const { data: row } = await sb.from("names").select("status").eq("id", id).single();
  if (!row) return fail("Name not found.");
  if (row.status === "reserved" || row.status === "used") return fail("This name is in a post. Edit it on the card instead, so the picture updates too.");
  const { error } = await sb.from("names").update({ name: normalizeName(v.name), meaning: v.meaning.trim().toLowerCase(), gender: v.gender, style: styleOf(v.name) }).eq("id", id);
  if (error) return fail(error.message.includes("names_lower_name") ? "That name is already in your list." : error.message);
  revalidatePath("/names");
  return { ok: true };
}

export async function setSkipAction(id: string, skip: boolean): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.from("names").update({ status: skip ? "skip" : "available" }).eq("id", id).in("status", skip ? ["available"] : ["skip"]).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(skip ? "Only available names can be skipped." : "This name is not marked Skip.");
  revalidatePath("/names");
  return { ok: true };
}

export async function deleteNameAction(id: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.from("names").delete().eq("id", id).in("status", ["available", "skip"]).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Names that were used in a post cannot be deleted. Mark it Skip instead.");
  revalidatePath("/names");
  return { ok: true };
}
