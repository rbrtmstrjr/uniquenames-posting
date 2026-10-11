"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CardRow, NameRow, PostRow } from "@/lib/db/types";
import { activePack } from "@/packs";
import { nameDetail } from "@/lib/names/detail";
import { isLetter, startsWith } from "@/lib/series/letter";
import { hasInitials, initialsText, isInitials } from "@/lib/series/initials";
import { loadInitialsStock } from "@/lib/data/initials";
import { validateName } from "./validate";
import { nameKey, nextSeed, restampMode, UUID_RE } from "./helpers";
import { generateLockReason } from "./generate-guard";
import { fail, requireOwner, type ActionResult } from "./result";

// The card dialog's "My names" tab: put a name from the Names page on a card (instead of typing one or taking an AI
// idea). The list offers the available names that fit the card's post; saving swaps them in one transaction
// (swap_card_name, migration 016): the new name is reserved for the post, the old one is free again.

type SB = Awaited<ReturnType<typeof createClient>>;

const PAGE = 20;
const Q_MAX = 60;
const CURSOR_MAX = 100_000;
const TAKEN = "That name was just used — pick another.";
const STALE = "This card just changed (it may be being made right now). Try again.";
const BUSY = "This card is being made right now. Wait for it to finish.";
const NOT_FOUND = "Card not found.";
const NAME_CARDS_ONLY = "Only the name cards of a post take a name from the Names page.";

/** `usedBefore`: on a post by initials (017), a name already used on an earlier post (offered after the unused ones). */
export type SwapName = { id: string; name: string; meaning: string; detail: string | null; usedBefore?: boolean };
export type SwapNamesResult = ActionResult<{ names: SwapName[]; next: number | null }>;

/** The search text, safe inside a PostgREST or() filter and a LIKE pattern. */
const cleanQuery = (q: string) => q.replace(/[%_,()"\\*:]/g, " ").replace(/\s+/g, " ").trim();

type CardBits = Pick<CardRow, "id" | "post_id" | "kind" | "name_id">;

async function cardAndPost(sb: SB, cardId: string): Promise<{ error: string } | { card: CardRow; post: PostRow }> {
  const { data: card } = await sb.from("cards").select("*").eq("id", cardId).maybeSingle();
  if (!card) return { error: NOT_FOUND };
  const c = card as CardRow;
  if (c.kind !== "post" || !c.post_id) return { error: NAME_CARDS_ONLY };
  // select * (letter is 013's column): works before and after the migration.
  const { data: post } = await sb.from("posts").select("*").eq("id", c.post_id).maybeSingle();
  if (!post) return { error: "Post not found." };
  return { card: c, post: post as PostRow };
}

/**
 * The available names that fit this card's post: same gender and style, the post's letter for a post by letter, never
 * a name already on the post. Name Nest lists the best US rank first; then (and on Unique Names) oldest first. `q`
 * searches name and meaning; `cursor` = how many were already shown (20 a page).
 */
export async function listSwapNamesAction(cardId: string, opts: { q?: string; cursor?: number } = {}): Promise<SwapNamesResult> {
  await requireOwner();
  if (!UUID_RE.test(cardId ?? "")) return fail(NOT_FOUND);
  const cursor = opts.cursor ?? 0;
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > CURSOR_MAX) return fail("Bad page. Reload and try again.");
  if (opts.q !== undefined && (typeof opts.q !== "string" || opts.q.length > Q_MAX)) return fail(`Search with at most ${Q_MAX} characters.`);
  const sb = await createClient();
  const got = await cardAndPost(sb, cardId);
  if ("error" in got) return fail(got.error);
  const { card, post } = got;
  if (isInitials(post.initials)) return listInitialsNames(sb, card, post.initials, post, opts.q, cursor);
  const { data: onPost, error: pe } = await sb.from("cards").select("name_id").eq("post_id", card.post_id!);
  if (pe) return fail(pe.message);
  const used = [...new Set(((onPost ?? []) as Pick<CardBits, "name_id">[]).map((c) => c.name_id).filter((x): x is string => !!x))];

  let query = sb.from("names").select("*").eq("gender", post.gender).eq("style", post.style).eq("status", "available");
  if (isLetter(post.letter)) query = query.ilike("name", `${post.letter}%`);
  if (used.length) query = query.not("id", "in", `(${used.join(",")})`);
  const q = cleanQuery(opts.q ?? "");
  if (q) query = query.or(`name.ilike."%${q}%",meaning.ilike."%${q}%"`);
  if (activePack().namePicker.order === "us-rank") query = query.order("us_rank", { ascending: true, nullsFirst: false });
  const { data, error } = await query.order("created_at").order("id").range(cursor, cursor + PAGE);
  if (error) return fail(error.message);
  const rows = (data ?? []) as NameRow[];
  return {
    ok: true,
    names: rows.slice(0, PAGE).map((n) => ({ id: n.id, name: n.name, meaning: n.meaning, detail: nameDetail(n) })),
    next: rows.length > PAGE ? cursor + PAGE : null,
  };
}

/**
 * My names on a post by initials (017): the two-word names of the post's gender with its initials that are not on the
 * post yet, unused ones first (Name Nest: best US rank first), then the names used before (least recently used
 * first), labelled `usedBefore`. `q` searches name and meaning; 20 a page.
 */
async function listInitialsNames(sb: SB, card: CardRow, initials: string, post: PostRow, q: string | undefined, cursor: number): Promise<SwapNamesResult> {
  const { data: onPost, error: pe } = await sb.from("cards").select("name_id, name, kind").eq("post_id", card.post_id!);
  if (pe) return fail(pe.message);
  const rows = (onPost ?? []) as { name_id: string | null; name: string | null; kind?: string }[];
  const got = await loadInitialsStock(sb, { gender: post.gender, initials, onPost: {
    nameIds: rows.map((r) => r.name_id).filter((x): x is string => !!x),
    names: rows.filter((r) => (r.kind ?? "post") === "post" && r.name).map((r) => r.name!),
  } });
  if (!got.ok) return fail(got.error);
  const rank = (n: NameRow) => (typeof n.us_rank === "number" ? n.us_rank : Infinity);
  const available = activePack().namePicker.order === "us-rank" ? [...got.stock.available].sort((a, b) => rank(a) - rank(b)) : got.stock.available;
  const all = [...available.map((n) => ({ n, usedBefore: false })), ...got.stock.used.map((n) => ({ n, usedBefore: true }))];
  const want = cleanQuery(q ?? "").toLowerCase();
  const hits = want ? all.filter(({ n }) => n.name.toLowerCase().includes(want) || n.meaning.toLowerCase().includes(want)) : all;
  return {
    ok: true,
    names: hits.slice(cursor, cursor + PAGE).map(({ n, usedBefore }) => ({
      id: n.id, name: n.name, meaning: n.meaning, detail: nameDetail(n), ...(usedBefore ? { usedBefore: true } : {}),
    })),
    next: hits.length > cursor + PAGE ? cursor + PAGE : null,
  };
}

const missingFunction = (e: { message: string; code?: string }) =>
  e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message);

type Mode = "restamp" | "regenerate";

/**
 * Before migration 016: the same swap as guarded steps. The new name is claimed first (only while still available),
 * then the card is updated version-guarded (the new name is given back if that fails), then the old name is freed
 * when no other card uses it.
 */
async function swapInSteps(sb: SB, card: CardRow, post: PostRow, name: NameRow, meaning: string, mode: Mode, seed: number): Promise<string | null> {
  const { data: got, error: ge } = await sb.from("names")
    .update({ status: post.status === "posted" ? "used" : "reserved", post_id: card.post_id, position: card.position, meaning })
    .eq("id", name.id).eq("status", "available").eq("gender", post.gender).eq("style", post.style).select("id");
  if (ge) return ge.message;
  if (!got?.length) return TAKEN;
  const now = new Date().toISOString();
  const version = card.version + 1;
  const text = { name: name.name, meaning, name_id: name.id };
  const patch = mode === "restamp"
    ? { ...text, status: "restamp", claimed_at: null, error: null, version, queued_at: now }
    : { ...text, status: "queued", claimed_at: null, started_at: null, finished_at: null, error: null, attempts: 0, version, seed, queued_at: now };
  const { data, error } = await sb.from("cards").update(patch).eq("id", card.id).eq("version", card.version).neq("status", "generating").select("id");
  if (error || !data?.length) {
    await sb.from("names").update({ status: "available", post_id: null, position: null, meaning: name.meaning }).eq("id", name.id);
    return error ? error.message : STALE;
  }
  if (card.name_id) {
    const { data: others } = await sb.from("cards").select("id").eq("name_id", card.name_id).neq("id", card.id).limit(1);
    if (!others?.length) {
      const { error: re } = await sb.from("names").update({ status: "available", post_id: null, position: null })
        .eq("id", card.name_id).in("status", ["reserved", "used"]);
      if (re) console.error("swapCardNameAction: could not free the old name", re.message);
    }
  }
  return null;
}

/**
 * My names on a post by initials (017): an unused name is reserved for the post as usual; a name used before goes on the
 * card as text only (its names row stays on its first post), in one transaction (swap_initials_card_name).
 */
async function swapInitialsName(sb: SB, o: { card: CardRow; post: PostRow; initials: string; name: NameRow | null; meaning: string; newPicture: boolean; lock: string | null }):
  Promise<ActionResult<{ mode: Mode }>> {
  const { card, post, name } = o;
  if (!name) return fail(TAKEN);
  if (card.name_id === name.id || (!card.name_id && nameKey(card.name) === nameKey(name.name))) return { ok: true, mode: restampMode(card) };
  if (name.gender !== post.gender || name.style !== "two-word") return fail("That name is for another kind of post (boy / girl or name style). Pick another.");
  const label = initialsText(o.initials);
  if (!hasInitials(name.name, o.initials)) return fail(`This post's names have the initials ${label}. Pick a name with those initials.`);
  if (!["available", "used", "reserved"].includes(name.status)) return fail(TAKEN);
  const bad = validateName(name.name, o.meaning);
  if (bad) return fail(bad);
  const mode: Mode = o.newPicture ? "regenerate" : restampMode(card);
  if (mode === "regenerate" && o.lock) return fail(o.lock);
  const { data, error } = await sb.rpc("swap_initials_card_name", {
    p_card: card.id, p_name: name.id, p_version: card.version, p_meaning: o.meaning.trim().toLowerCase(), p_mode: mode, p_seed: nextSeed(card.id, card.version + 1, card.seed),
  });
  if (error) return fail(missingFunction(error) ? "Run supabase/migrations/017_initials_posts.sql in Supabase first, then try again." : error.message);
  const r = data as { status: string; reason?: string };
  if (r.status === "taken") return fail(TAKEN);
  if (r.status === "stale") return fail(STALE);
  if (r.status !== "ok") return fail(r.reason ?? "Could not change the name. Try again.");
  revalidatePath("/names");
  return { ok: true, mode };
}

/**
 * "Save text" (or "New picture") after picking a name in My names: the card takes that name and the meaning in the
 * field, and is queued again: the photo is kept and only the text is re-stamped, unless `newPicture` (or the card has
 * no clean photo) makes a new photo. The new name is reserved for the post; the old one goes back to the Names page.
 */
export async function swapCardNameAction(cardId: string, nameId: string, meaning: string, opts: { newPicture?: boolean } = {}): Promise<ActionResult<{ mode: Mode }>> {
  await requireOwner();
  if (!UUID_RE.test(cardId ?? "")) return fail(NOT_FOUND);
  if (!UUID_RE.test(nameId ?? "")) return fail("Pick a name from the list.");
  if (typeof meaning !== "string" || !meaning.trim()) return fail("Type the meaning.");
  const sb = await createClient();
  const [got, lock, { data: nameRow }] = await Promise.all([
    cardAndPost(sb, cardId),
    generateLockReason(sb),
    sb.from("names").select("*").eq("id", nameId).maybeSingle(),
  ]);
  if ("error" in got) return fail(got.error);
  const { card, post } = got;
  if (card.status === "generating") return fail(BUSY);
  const name = nameRow as NameRow | null;
  if (isInitials(post.initials)) return swapInitialsName(sb, { card, post, initials: post.initials, name, meaning, newPicture: !!opts.newPicture, lock });
  // Already this card's name (a second tap after it saved): nothing to do.
  if (name && card.name_id === name.id) return { ok: true, mode: restampMode(card) };
  if (!name || name.status !== "available") return fail(TAKEN);
  if (name.gender !== post.gender || name.style !== post.style) return fail("That name is for another kind of post (boy / girl or name style). Pick another.");
  if (isLetter(post.letter) && !startsWith(name.name, post.letter)) return fail(`This post's names start with ${post.letter}. Pick a ${post.letter} name.`);
  const bad = validateName(name.name, meaning);
  if (bad) return fail(bad);
  const mode: Mode = opts.newPicture ? "regenerate" : restampMode(card);
  if (mode === "regenerate" && lock) return fail(lock);
  const clean = meaning.trim().toLowerCase();
  const seed = nextSeed(card.id, card.version + 1, card.seed);

  const { data, error } = await sb.rpc("swap_card_name", {
    p_card: card.id, p_name: name.id, p_version: card.version, p_meaning: clean, p_mode: mode, p_seed: seed,
  });
  if (error) {
    if (!missingFunction(error)) return fail(error.message);
    const err = await swapInSteps(sb, card, post, name, clean, mode, seed);
    if (err) return fail(err);
  } else {
    const r = data as { status: string; reason?: string };
    if (r.status === "taken") return fail(TAKEN);
    if (r.status === "stale") return fail(STALE);
    if (r.status !== "ok") return fail(r.reason ?? "Could not change the name. Try again.");
  }
  revalidatePath("/names");
  return { ok: true, mode };
}
