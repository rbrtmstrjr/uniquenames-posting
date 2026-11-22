// Caption samples for the owner (spec 2026-11-21): 12 real AI captions (6 posts, 2 angles each) in the Unique Names voice, printed as Markdown.
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
  { label: "Letter M · girl", gender: "girl", style: "single", letter: "M", theme: set("Spring Meadow Girl"),
    names: [{ name: "Mira", meaning: "wonderful" }, { name: "Margot", meaning: "pearl" }, { name: "Mila", meaning: "gracious and dear" }] },
  { label: "Letter J · boy", gender: "boy", style: "single", letter: "J", theme: set("Little Explorer"),
    names: [{ name: "Jude", meaning: "praised" }, { name: "Jasper", meaning: "bringer of treasure" }, { name: "Joaquin", meaning: "God will establish" }] },
  { label: "Strong and brave · boy", gender: "boy", style: "single", nameTheme: { title: "Strong and brave", hint: null }, theme: set("Knight's Quest Boy"),
    names: [{ name: "Ethan", meaning: "strong and firm" }, { name: "Leon", meaning: "lion" }, { name: "Andre", meaning: "manly and brave" }] },
  { label: "Heavenly · girl", gender: "girl", style: "single", nameTheme: { title: "Heavenly", hint: "stars, sky, light" }, theme: set("Starry Night Girl"),
    names: [{ name: "Stella", meaning: "star" }, { name: "Celeste", meaning: "heavenly" }, { name: "Aurora", meaning: "dawn" }] },
  { label: "Plain · boy", gender: "boy", style: "single", theme: set("Cozy Cabin Boy"),
    names: [{ name: "Noah", meaning: "rest and comfort" }, { name: "Elias", meaning: "the Lord is my God" }, { name: "Theo", meaning: "gift of God" }] },
  // A real initials post (lib/actions/initials.ts) passes style "two-word", "First Middle" names with a short lowercase meaning, and initials "AR".
  { label: "Initials A & R · girl", gender: "girl", style: "two-word", initials: "AR", theme: set("Rose Garden Girl"),
    names: [{ name: "Ava Rose", meaning: "life and flower" }, { name: "Amara Ruth", meaning: "grace and compassion" }, { name: "Aria Rae", meaning: "song and ray of light" }] },
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
    for (let j = 0; j < 2; j++) {
      const captionStyle = CAPTION_STYLES[k++ % CAPTION_STYLES.length];
      const { label, ...input } = post;
      // aiCaptionLine logs why it gave up with console.warn: capture it for the reason, then restore.
      const warned: string[] = [];
      const realWarn = console.warn;
      console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(" ")); };
      let ai;
      try { ai = await aiCaptionLine({ ...input, captionStyle, recent: [...recent].reverse().slice(0, 8) }, 20000); } finally { console.warn = realWarn; }
      const reason = warned.at(-1) ?? "no reason logged";
      out.push(`**${label} · ${captionStyle}**`, ai ? ai.line : `_(no AI caption: the template would be used — ${reason})_`, "");
      if (ai) recent.push(ai.line);
    }
  }
  console.log(out.join("\n"));
}

void main();
