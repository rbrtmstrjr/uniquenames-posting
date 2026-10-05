import Link from "next/link";
export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl text-ink">Reel not found</h1>
      <p className="mt-2 text-sm text-muted">It may have been deleted.</p>
      <Link href="/reels" className="mt-4 inline-flex min-h-11 items-center font-bold text-accent">Back to reels</Link>
    </div>
  );
}
