"use server";
import { createClient } from "@/lib/supabase/server";
import type { CardRow } from "@/lib/db/types";
import { validateName } from "./validate";
import { normalizeName, restampMode, styleOf } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

const REQUEUE = { status: "queued", claimed_at: null, started_at: null, finished_at: null, error: null, attempts: 0 };

async function getCard(id: string) {
  const sb = await createClient();
  const { data } = await sb.from("cards").select("*").eq("id", id).single();
  return { sb, card: data as CardRow | null };
}

const STALE = "This card just changed (it may be being made right now). Try again.";

export async function regenerateCardAction(cardId: string): Promise<ActionResult> {
  await requireOwner();
  const { sb, card } = await getCard(cardId);
  if (!card) return fail("Card not found.");
  if (card.status === "generating") return fail("This card is being made right now. Wait for it to finish.");
  const { data, error } = await sb.from("cards").update({ ...REQUEUE, version: card.version + 1, queued_at: new Date().toISOString() })
    .eq("id", cardId).eq("version", card.version).neq("status", "generating").select("id");
  if (error) return fail(error.message);
  return data?.length ? { ok: true } : fail(STALE);
}

export async function restampCardAction(cardId: string, name: string, meaning: string): Promise<ActionResult<{ mode: "restamp" | "regenerate" }>> {
  await requireOwner();
  const bad = validateName(name, meaning);
  if (bad) return fail(bad);
  const { sb, card } = await getCard(cardId);
  if (!card) return fail("Card not found.");
  if (card.status === "generating") return fail("This card is being made right now. Wait for it to finish.");
  const clean = { name: normalizeName(name), meaning: meaning.trim().toLowerCase() };

  if (card.name_id) {
    const { data: dup } = await sb.from("names").select("id").ilike("name", clean.name).neq("id", card.name_id).limit(1);
    if (dup?.length) return fail("Another name in your list already has that spelling.");
  }

  // Restamp only when a clean photo is current; a pending regenerate or an imported card regenerates instead.
  const mode = restampMode(card);
  const now = new Date().toISOString();
  const patch = mode === "restamp"
    ? { ...clean, status: "restamp", claimed_at: null, error: null, version: card.version + 1, queued_at: now }
    : { ...clean, ...REQUEUE, version: card.version + 1, queued_at: now };
  const { data, error } = await sb.from("cards").update(patch).eq("id", cardId).eq("version", card.version).neq("status", "generating").select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(STALE);

  if (card.name_id) {
    const { error: ne } = await sb.from("names").update({ ...clean, style: styleOf(clean.name) }).eq("id", card.name_id);
    if (ne) {
      // Put the card back as it was so the card and its name never disagree.
      await sb.from("cards").update({ name: card.name, meaning: card.meaning, status: card.status, claimed_at: card.claimed_at, error: card.error, version: card.version, queued_at: card.queued_at, started_at: card.started_at, finished_at: card.finished_at, attempts: card.attempts }).eq("id", cardId);
      return fail(ne.message.includes("names_lower_name") ? "Another name in your list already has that spelling." : ne.message);
    }
  }
  return { ok: true, mode };
}

export async function deleteCardAction(cardId: string): Promise<ActionResult> {
  await requireOwner();
  const sb = await createClient();
  const { data, error } = await sb.rpc("delete_card", { p_card: cardId });
  if (error) return fail(error.message);
  const paths = (data as { paths: string[] }).paths ?? [];
  if (paths.length) {
    const { error: re } = await sb.storage.from("cards").remove(paths);
    if (re) console.error("deleteCardAction: storage cleanup failed", re.message);
  }
  return { ok: true };
}

export async function setSelectedAction(cardId: string, selected: boolean): Promise<ActionResult> {
  await requireOwner();
  const { data, error } = await (await createClient()).from("cards").update({ selected }).eq("id", cardId).select("id");
  if (error) return fail(error.message);
  return data?.length ? { ok: true } : fail("Card not found.");
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
