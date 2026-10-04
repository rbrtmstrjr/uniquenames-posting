import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

export function Stock({ stock, themes, min }: { stock: { label: string; count: number }[]; themes: { boy: number; girl: number }; min: number }) {
  const low = (n: number) => n < min * 2;
  return (
    <Panel title="Stock left">
      <ul className="space-y-2 text-sm">
        {stock.map((s) => (
          <li key={s.label} className="flex items-center justify-between">
            <span className="text-muted">{s.label}</span>
            <span className={cn("font-bold", low(s.count) ? "text-warn" : "text-ink")}>{s.count}</span>
          </li>
        ))}
        <li className="flex items-center justify-between border-t border-line pt-2">
          <span className="text-muted">Themes · boy / girl</span>
          <span className={cn("font-bold", (themes.boy < 3 || themes.girl < 3) ? "text-warn" : "text-ink")}>{themes.boy} / {themes.girl}</span>
        </li>
      </ul>
      {stock.some((s) => low(s.count)) && <Link href="/names" className="mt-3 inline-block text-xs font-bold text-accent">Running low: add names →</Link>}
    </Panel>
  );
}
