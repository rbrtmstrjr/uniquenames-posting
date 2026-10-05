"use server";
import { createClient } from "@/lib/supabase/server";
import type { CardRow } from "@/lib/db/types";
import { validateName } from "./validate";
import { nextSeed, normalizeName, restampMode, styleOf } from "./helpers";
import { generateLockReason } from "./generate-guard";
import { fail, requireOwner, type ActionResult } from "./result";
import { textChanged } from "@/lib/status/card-dialog";

type SB = Awaited<ReturnType<typeof createClient>>;

const REQUEUE = { status: "queued", claimed_at: null, started_at: null, finished_at: null, error: null, attempts: 0 };

/** The card plus the Generate lock (worker health), read in parallel. */
async function getCard(id: string) {
  const sb = await createClient();
  const [{ data }, lock] = await Promise.all([sb.from("cards").select("*").eq("id", id).single(), generateLockReason(sb)]);
  return { sb, card: data as CardRow | null, lock };
}

const STALE = "This card just changed (it may be being made right now). Try again.";
const BUSY = "This card is being made right now. Wait for it to finish.";
const DUP = "Another name in your list already has that spelling.";

const cleanText = (name: string, meaning: string) => ({ name: normalizeName(name), meaning: meaning.trim().toLowerCase() });

async function spellingTaken(sb: SB, card: CardRow, name: string) {
  if (!card.name_id) return false;
  const { data: dup } = await sb.from("names").select("id").ilike("name", name).neq("id", card.name_id).limit(1);
  return !!dup?.length;
}

/**
 * Keep the names row in step with the card's new text. On failure, put the card back
 * exactly as it was (only if nothing moved it on since) so the two never disagree.
 */
async function saveNameRow(sb: SB, card: CardRow, clean: { name: string; meaning: string }): Promise<string | null> {
  if (!card.name_id) return null;
  const { error: ne } = await sb.from("names").update({ ...clean, style: styleOf(clean.name) }).eq("id", card.name_id);
  if (!ne) return null;
  await sb.from("cards").update({
    name: card.name, meaning: card.meaning, status: card.status, claimed_at: card.claimed_at, error: card.error, version: card.version, seed: card.seed,
    queued_at: card.queued_at, started_at: card.started_at, finished_at: card.finished_at, attempts: card.attempts,
  }).eq("id", card.id).eq("version", card.version + 1);
  return ne.message.includes("names_lower_name") ? DUP : ne.message;
}

/**
 * "New picture" / Retry. With `text` that differs from the card (the dialog's edited
 * name/meaning), the new text and the requeue land in ONE version-guarded update, so the
 * worker stamps the new name on the new photo. Every new version gets a new seed:
 * ComfyUI is deterministic, so the same seed would remake the same photo.
 */
export async function regenerateCardAction(cardId: string, text?: { name: string; meaning: string }): Promise<ActionResult> {
  await requireOwner();
  if (text) {
    const bad = validateName(text.name, text.meaning);
    if (bad) return fail(bad);
  }
  const { sb, card, lock } = await getCard(cardId);
  if (!card) return fail("Card not found.");
  if (card.status === "generating") return fail(BUSY);
  if (lock) return fail(lock);
  const clean = text && textChanged(card, text.name, text.meaning) ? cleanText(text.name, text.meaning) : null;
  if (clean && (await spellingTaken(sb, card, clean.name))) return fail(DUP);

  const version = card.version + 1;
  const patch = { ...clean, ...REQUEUE, version, seed: nextSeed(card.id, version, card.seed), queued_at: new Date().toISOString() };
  const { data, error } = await sb.from("cards").update(patch).eq("id", cardId).eq("version", card.version).neq("status", "generating").select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(STALE);
  if (clean) {
    const bad = await saveNameRow(sb, card, clean);
    if (bad) return fail(bad);
  }
  return { ok: true };
}

export async function restampCardAction(cardId: string, name: string, meaning: string): Promise<ActionResult<{ mode: "restamp" | "regenerate" }>> {
  await requireOwner();
  const bad = validateName(name, meaning);
  if (bad) return fail(bad);
  const { sb, card, lock } = await getCard(cardId);
  if (!card) return fail("Card not found.");
  if (card.status === "generating") return fail(BUSY);
  // Restamp only when a clean photo is current; a pending regenerate or an imported card regenerates instead.
  // A re-stamp only needs Pillow, so only the regenerate path is locked by the PC / ComfyUI state.
  const mode = restampMode(card);
  if (mode === "regenerate" && lock) return fail(lock);
  const clean = cleanText(name, meaning);
  if (await spellingTaken(sb, card, clean.name)) return fail(DUP);

  const version = card.version + 1;
  const now = new Date().toISOString();
  const patch = mode === "restamp"
    ? { ...clean, status: "restamp", claimed_at: null, error: null, version, queued_at: now }
    : { ...clean, ...REQUEUE, version, seed: nextSeed(card.id, version, card.seed), queued_at: now };
  const { data, error } = await sb.from("cards").update(patch).eq("id", cardId).eq("version", card.version).neq("status", "generating").select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail(STALE);
  const nameErr = await saveNameRow(sb, card, clean);
  if (nameErr) return fail(nameErr);
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
