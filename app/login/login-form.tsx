"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/shadcn/input";
import { createClient } from "@/lib/supabase/client";

const DENIED = "This account isn't allowed to use this site.";

export function LoginForm({ next, denied = false }: { next: string; denied?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The proxy sent a signed-in non-owner here: drop that session so the form starts clean.
  useEffect(() => {
    if (denied) void createClient().auth.signOut({ scope: "local" });
  }, [denied]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setError("Wrong email or password."); setBusy(false); return; }
    // Full navigation so the proxy decides with the fresh cookie: the owner lands on `next`,
    // any other account comes back as /login?denied=1 with a fresh form and the message below.
    window.location.assign(next);
  }

  const shown = error ?? (denied ? DENIED : null);

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-semibold text-ink">Email</span>
        <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-ink">Password</span>
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
      </label>
      {shown && <p role="alert" className="text-sm font-medium text-bad">{shown}</p>}
      <Button type="submit" loading={busy} className="w-full font-bold">Sign in</Button>
    </form>
  );
}
