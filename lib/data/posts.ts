import { createClient } from "@/lib/supabase/server";
import type { CardRow, PostRow, ThemeRow } from "@/lib/db/types";

export type PostListItem = PostRow & { theme_title: string; cards: Pick<CardRow, "id" | "status" | "card_path" | "position">[] };

export async function getPostList(): Promise<PostListItem[]> {
  const sb = await createClient();
  const { data } = await sb.from("posts").select("*, themes(title), cards(id, status, card_path, position)")
    .order("post_date", { ascending: false }).order("created_at", { ascending: false }).limit(90);
  return (data ?? []).map((p) => {
    const { themes, cards, ...rest } = p as PostRow & { themes: { title: string } | null; cards: PostListItem["cards"] };
    return { ...rest, theme_title: themes?.title ?? "", cards: [...(cards ?? [])].sort((a, b) => a.position - b.position) };
  });
}

export async function getPost(id: string) {
  const sb = await createClient();
  const { data: post } = await sb.from("posts").select("*").eq("id", id).maybeSingle();
  if (!post) return null;
  const [{ data: theme }, { data: cards }] = await Promise.all([
    sb.from("themes").select("*").eq("id", (post as PostRow).theme_id).single(),
    sb.from("cards").select("*").eq("post_id", id).order("position"),
  ]);
  return { post: post as PostRow, theme: theme as ThemeRow, cards: (cards ?? []) as CardRow[] };
}
