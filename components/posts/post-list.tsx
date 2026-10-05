"use client";
import Link from "next/link";
import { useState } from "react";
import { Images, Plus } from "lucide-react";
import type { PostListItem } from "@/lib/data/posts";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { useSignedUrls } from "@/lib/realtime/signed-urls";
import { FadeImage } from "@/components/ui/fade-image";

type Filter = "all" | "ready" | "posted";

export function statusBadge(p: Pick<PostListItem, "status" | "cards">) {
  const failed = p.cards.filter((c) => c.status === "failed").length;
  const done = p.cards.filter((c) => c.status === "done").length;
  if (failed) return <Badge tone="bad">{failed} failed</Badge>;
  if (p.status === "generating") return <Badge tone="accent" pulse>Generating {done}/{p.cards.length}</Badge>;
  if (p.status === "posted") return <Badge tone="muted">Posted</Badge>;
  return <Badge tone="ok">Ready</Badge>;
}

export function PostList({ posts }: { posts: PostListItem[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = posts.filter((p) => filter === "all" || (filter === "ready" ? p.status !== "posted" : p.status === "posted"));
  const urlFor = useSignedUrls(shown.flatMap((p) => p.cards.slice(0, 6).map((c) => c.card_path)));

  if (!posts.length) {
    return <Empty icon={<Images className="size-6" />} title="No posts yet" text="Make your first post on the Today page."
      action={<Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink"><Plus className="size-4" /> New post</Link>} />;
  }
  return (
    <div className="space-y-4">
      <Segmented label="Filter posts" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "ready", label: "Not posted" }, { value: "posted", label: "Posted" }]} />
      {!shown.length && <Empty icon={<Images className="size-6" />} title={filter === "posted" ? "Nothing posted yet" : "Nothing waiting to post"} text={filter === "posted" ? "Posts you mark as posted show up here." : "Every post has been marked as posted."} />}
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((p) => (
          <li key={p.id}>
            <Link href={`/posts/${p.id}`} className="block rounded-2xl border border-line bg-surface p-3 shadow-soft transition hover:border-accent/40">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink">
                    {new Date(p.post_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {p.gender === "girl" ? "Girl" : "Boy"}
                  </div>
                  <div className="text-xs text-muted">{p.theme_title} · {p.style} · {p.cards.length} cards</div>
                </div>
                {statusBadge(p)}
              </div>
              <div className="mt-3 grid grid-cols-6 gap-1.5">
                {p.cards.slice(0, 6).map((c) => (
                  <div key={c.id} className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">
                    {c.card_path ? <FadeImage src={urlFor(c.card_path)} />
                      : <div className={c.status === "done" ? "size-full" : "size-full shimmer animate-shimmer"} />}
                  </div>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
