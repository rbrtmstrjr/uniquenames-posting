// Caption samples for the owner (spec 2026-11-21): 12 real AI captions in the Unique Names voice, printed as Markdown.
// Uses the same AI as the site (AI_PROVIDER, GEMINI_API_KEY / ANTHROPIC_API_KEY from .env.local; nothing is printed
// about the keys). Costs well under a cent. Run:
//   npx tsx --conditions=react-server scripts/caption-samples.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  const f = join(process.cwd(), ".env.local");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^(AI_PROVIDER|GEMINI_API_KEY|ANTHROPIC_API_KEY)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
type Input = import("@/lib/ai/caption").CaptionInput;

const set = (title: string) => ({ title, backdrop: "-", outfit: "-", props: "-", lighting: "-", palette: "-" });
const POSTS: (Omit<Input, "captionStyle" | "recent"> & { label: string })[] = [
  { label: "Letter R · girl", gender: "girl", style: "single", letter: "R", theme: set("Farmyard Friends"),
    names: [{ name: "Rosalie", meaning: "rose" }, { name: "Raya", meaning: "friend" }, { name: "Reign", meaning: "to rule" }] },
  { label: "Letter K · boy", gender: "boy", style: "single", letter: "K", theme: set("Little Gentleman"),
    names: [{ name: "Kai", meaning: "the sea" }, { name: "Kian", meaning: "ancient" }, { name: "Kenji", meaning: "strong and healthy" }] },
  { label: "Biblical · boy", gender: "boy", style: "single", nameTheme: { title: "Biblical", hint: null }, theme: set("Olive Grove Boy"),
    names: [{ name: "Ezekiel", meaning: "god strengthens" }, { name: "Josiah", meaning: "god supports" }, { name: "Gideon", meaning: "great warrior" }] },
  { label: "Soft and cool · girl", gender: "girl", style: "single", nameTheme: { title: "Soft and cool", hint: null }, theme: set("Cloud Nine Girl"),
    names: [{ name: "Luna", meaning: "the moon" }, { name: "Wren", meaning: "small songbird" }, { name: "Mila", meaning: "gracious and dear" }] },
];

async function main() {
  loadEnv();
  // Imported after the keys are loaded (the AI modules read them when called).
  const { aiCaptionLine } = await import("@/lib/ai/caption");
  const { CAPTION_STYLES } = await import("@/lib/captions/styles");
  const recent: string[] = [];
  const out: string[] = ["# Caption samples (mom-to-mom, theme first)", ""];
  let k = 0;
  for (const post of POSTS) {
    for (let j = 0; j < 3; j++) {
      const captionStyle = CAPTION_STYLES[k++ % CAPTION_STYLES.length];
      const { label, ...input } = post;
      const ai = await aiCaptionLine({ ...input, captionStyle, recent: [...recent].reverse().slice(0, 8) }, 20000);
      out.push(`**${label} · ${captionStyle}**`, ai ? ai.line : "_(no AI caption: the template would be used)_", "");
      if (ai) recent.push(ai.line);
    }
  }
  console.log(out.join("\n"));
}

void main();
