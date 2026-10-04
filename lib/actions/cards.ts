"use server";
import { createClient } from "@/lib/supabase/server";
import type { CardRow } from "@/lib/db/types";
import { validateName } from "./validate";
import { fail, requireOwner, type ActionResult } from "./result";

const REQUEUE = { status: "queued", claimed_at: null, started_at: null, finished_at: null, error: null, attempts: 0 };

async function getCard(id: string) {
  const sb = await createClient();
  const { data } = await sb.from("cards").select("*").eq("id", id).single();
  return { sb, card: data as CardRow | null };
}

export async function regenerateCardAction(cardId: string): Promise<ActionResult> {
  await requireOwner();
  const { sb, card } = await getCard(cardId);
  if (!card) return fail("Card not found.");
  if (card.status === "generating") return fail("This card is being made right now. Wait for it to finish.");
  const { error } = await sb.from("cards").update({ ...REQUEUE, version: card.version + 1, queued_at: new Date().toISOString() }).eq("id", cardId);
  return error ? fail(error.message) : { ok: true };
}

export async function restampCardAction(cardId: string, name: string, meaning: string): Promise<ActionResult<{ mode: "restamp" | "regenerate" }>> {
  await requireOwner();
  const bad = validateName(name, meaning);
  if (bad) return fail(bad);
  const { sb, card } = await getCard(cardId);
  if (!card) return fail("Card not found.");
  if (card.status === "generating") return fail("This card is being made right now. Wait for it to finish.");
  const clean = { name: name.replace(/\s+/g, " ").trim(), meaning: meaning.trim().toLowerCase() };
  if (card.name_id) {
    const { error: ne } = await sb.from("names").update(clean).eq("id", card.name_id);
    if (ne) return fail(ne.message.includes("names_lower_name") ? "Another name in your list already has that spelling." : ne.message);
  }
  // Cards imported from the n8n flow have no clean photo, so they regenerate instead.
  const mode = card.photo_path ? "restamp" : "regenerate";
  const patch = mode === "restamp"
    ? { ...clean, status: "restamp", claimed_at: null, error: null, version: card.version + 1, queued_at: new Date().toISOString() }
    : { ...clean, ...REQUEUE, version: card.version + 1, queued_at: new Date().toISOString() };
  const { error } = await sb.from("cards").update(patch).eq("id", cardId);
  return error ? fail(error.message) : { ok: true, mode };
}

export async function deleteCardAction(cardId: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.rpc("delete_card", { p_card: cardId });
  if (error) return fail(error.message);
  const paths = (data as { paths: string[] }).paths ?? [];
  if (paths.length) await sb.storage.from("cards").remove(paths);
  return { ok: true };
}

export async function setSelectedAction(cardId: string, selected: boolean): Promise<ActionResult> {
  await requireOwner();
  const { error } = await (await createClient()).from("cards").update({ selected }).eq("id", cardId);
  return error ? fail(error.message) : { ok: true };
}

export async function selectAllAction(postId: string, selected: boolean): Promise<ActionResult> {
  await requireOwner();
  const { error } = await (await createClient()).from("cards").update({ selected }).eq("post_id", postId);
  return error ? fail(error.message) : { ok: true };
}

export async function reorderCardsAction(postId: string, orderedIds: string[]): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const results = await Promise.all(orderedIds.map((id, i) => sb.from("cards").update({ order_index: i + 1 }).eq("id", id).eq("post_id", postId)));
  const err = results.find((r) => r.error)?.error;
  return err ? fail(err.message) : { ok: true };
}
