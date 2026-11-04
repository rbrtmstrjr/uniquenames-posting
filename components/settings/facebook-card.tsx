"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { checkFacebookAction } from "@/lib/actions/facebook";
import { callAction } from "@/lib/actions/call";

/** Post now / Schedule to Facebook: are the keys set, and do they work (one check, on demand)? */
export function FacebookCard({ connected }: { connected: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; pageName: string } | { ok: false; error: string } | null>(null);
  const check = async () => {
    setBusy(true);
    setResult(await callAction(() => checkFacebookAction()));
    setBusy(false);
  };
  return (
    <Panel title="Facebook">
      {connected ? (
        <div className="space-y-3 text-sm">
          <p className="text-ink">Post now and Schedule are on. Check that Facebook still accepts the app&apos;s key:</p>
          <Button variant="subtle" size="sm" onClick={() => void check()} loading={busy}>Check connection</Button>
          {result && (result.ok
            ? <p className="font-semibold text-ink" role="status">Connected to {result.pageName || "your Page"}.</p>
            : <p className="text-bad" role="status">{result.error}</p>)}
        </div>
      ) : (
        <p className="rounded-xl border border-warn bg-warn/12 p-3 text-sm text-ink">
          Not connected. Add FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN and FACEBOOK_APP_SECRET in Vercel (Sensitive), then redeploy.
          The steps are in docs/SETUP.md, &quot;Posting to Facebook&quot;.
        </p>
      )}
    </Panel>
  );
}
