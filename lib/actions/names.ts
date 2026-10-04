"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Gender, NameStyle } from "@/lib/db/types";
import { validateName } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

const styleOf = (name: string): NameStyle => (name.trim().split(/\s+/).length > 1 ? "two-word" : "single");

// `style` is accepted for caller convenience but always derived from the name itself.
export async function addNamesAction(rows: { name: string; meaning: string; gender: Gender; style?: NameStyle }[]): Promise<ActionResult<{ added: number; skipped: string[] }>> {
  await requireOwner();
  if (!rows.length) return fail("Nothing to add.");
  if (rows.length > 1000) return fail("Add at most 1000 names at a time.");
  for (const r of rows) { const bad = validateName(r.name, r.meaning); if (bad) return fail(`${r.name}: ${bad}`); }
  const sb = await createClient();
  const { data: existing } = await sb.from("names").select("name");
  const have = new Set((existing ?? []).map((n) => (n.name as string).toLowerCase()));
  const skipped: string[] = [];
  const fresh = rows.filter((r) => { const k = r.name.trim().toLowerCase(); if (have.has(k)) { skipped.push(r.name); return false; } have.add(k); return true; })
    .map((r) => ({ name: r.name.replace(/\s+/g, " ").trim(), meaning: r.meaning.trim().toLowerCase(), gender: r.gender, style: styleOf(r.name) }));
  if (fresh.length) {
    const { error } = await sb.from("names").insert(fresh);
    if (error) return fail(error.message);
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
  const { error } = await sb.from("names").update({ name: v.name.replace(/\s+/g, " ").trim(), meaning: v.meaning.trim().toLowerCase(), gender: v.gender, style: styleOf(v.name) }).eq("id", id);
  if (error) return fail(error.message.includes("names_lower_name") ? "That name is already in your list." : error.message);
  revalidatePath("/names");
  return { ok: true };
}

export async function setSkipAction(id: string, skip: boolean): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { error } = await sb.from("names").update({ status: skip ? "skip" : "available" }).eq("id", id).in("status", skip ? ["available"] : ["skip"]);
  if (error) return fail(error.message);
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
