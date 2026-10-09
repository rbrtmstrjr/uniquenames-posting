// Writing a reel script (Gemini 3.1 Pro, up to 2 automatic rewrites) can take a few minutes.
// Server actions run with the invoking page's limit, so every /reels page gets the Vercel Hobby max.
export const maxDuration = 300;

export default function ReelsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
