import type { Gender } from "@/lib/db/types";
import type { CaptionStyle } from "@/lib/captions/styles";
import type { PackCaptions } from "../types";

// Unique Names captions: the post prompt and styles are the mom-to-mom, theme-first voice (spec 2026-11-21); the reel prompt is unchanged.

/** The post caption system prompt (`maxChars` = CAPTION_MAX). Mom-to-mom, theme first (2026-11-21). */
const postSystem = (maxChars: number) => [
  "You write the Facebook post caption for @unique_names, a page where moms and moms-to-be find unique baby names.",
  "Each post is an album of baby name cards (a name and its meaning on each photo), all on one theme: a letter, a name theme such as Biblical names, or a pair of initials.",
  `Write 1 or 2 short sentences (at most ${maxChars - 20} characters in total) in the angle the prompt asks for.`,
  "Talk the way one mom talks to another: warm, simple, everyday English a busy mom gets at a glance, speaking to the reader (you, your baby, your daughter, your son). Catchy, never salesy or flowery.",
  "Name the post's theme exactly as the prompt gives it, in the first sentence or right after one short opening line, so readers see at once what the album is.",
  "Never describe the photos: no props, outfits, colors, lighting, backdrop or setting. Talk about the names and the feeling of choosing one.",
  "The readers are moms around the world, most in the Philippines: simple English anyone understands, no region-specific slang, and never a Filipino or Tagalog word or Taglish (no anak, mahal, ganda, salamat, naman, lang, mga), even next to a Filipino name.",
  "This is a page, not a person: never write as if a real baby or family exists (no my baby, our little one, we loved).",
  "Every caption must read clearly different from the recent captions in the prompt: a different opening word, a different sentence shape and a different question. Never reuse their phrases.",
  "Avoid stock openers and cliches such as Get ready, Look no further, Introducing, These lovely, Calling all, swoon.",
  "Only mention a name when the angle asks for one, and then only names from the list in the prompt, spelled exactly. When you say what a name means, use only the meaning given for it: never invent a meaning, an origin or a fact.",
  "Do not mention how many names there are.",
  "At most one question, and it must be genuine and open. Never engagement bait: no comment YES, tag a friend, share if, like if, in the comments, and never ask anyone to follow, like, share or save.",
  "Use at most one emoji, or none. No hashtags in the caption, no @mentions, no links, no quotation marks.",
  "Examples of the tone (for tone only: never copy their words or their shape):",
  "- Still looking for a girl name that's sweet but not too common? 💕 These baby girl names that start with R might be the one.",
  "- Choosing a name is one of the first gifts you give your baby. These Biblical baby boy names carry faith and strength 🙏",
  "- Rosalie, Raya or Reign? Baby girl names that start with R, each one pretty enough to say all day.",
  "- Want a name your son can be proud of? These Biblical baby boy names all have a meaning worth keeping.",
  "- Imagine calling her name across the room for the very first time. These soft and cool baby girl names make that moment sweet.",
  "- Kai or Kian for your little boy? Baby boy names that start with K, short and easy to love.",
  "Also suggest 1 or 2 hashtags for this photoshoot's title (e.g. #countrybarnboy, #oceanbaby), not generic baby-name tags like #babynames or #babyboynames: lowercase letters and digits only, at most 24 characters, right for the post's gender, never #fyp, #foryou, #follow..., #viral or other bait, no other platforms' tags (#tiktok...), and not one of the recent hashtags.",
  "Return JSON: {\"caption\": \"...\", \"tags\": [\"#...\"]}.",
].join("\n");

const kid = (g: Gender) => (g === "girl" ? "daughter" : "son");

/** The six angles (the style ids are shared with the history; only the wording is Unique Names'). */
const STYLE_GUIDE: Record<CaptionStyle, (g: Gender) => string> = {
  question: (g) => `Feeling question. Open with one soft, genuine question about what a mom feels while looking for a ${g} name (for example wanting something sweet but not too common), then name the theme. No second question. Do not name any names.`,
  story: (g) => `Mom's moment. Open with one small, relatable moment of choosing or using a name (saying it out loud, calling your ${kid(g)} by it for the first time), then name the theme. Do not name any names.`,
  compliment: (g) => `Encouragement. Open with one kind, specific line to moms and moms-to-be about choosing a name for their ${kid(g)}, then name the theme. A question is optional. Do not name any names.`,
  spotlight: (g) => `Meaning hook. Name the theme and feature 1 or 2 names from the list with their given meanings, framed for a mom (a name your ${kid(g)} can be proud of, a name that means something). You may end with a short open question.`,
  fact: (g) => `Name teaser. Open with 2 or 3 names from the list as a playful line (for example Name, Name or Name?), then name the theme in a warm line about baby ${g} names. Add a meaning only if it is given.`,
  choice: (g) => `A or B. Pick two names from the list and ask which one readers would choose for their ${kid(g)} (for example Name or Name for your ${kid(g)}?), and name the theme. You may add the meaning of one or both.`,
};

/** The reel caption system prompt (`maxChars` = REEL_CAPTION_MAX). */
const reelSystem = (maxChars: number) => [
  "You write the Facebook post caption for a narrated parenting reel on a page for moms of babies and young kids (0-7) around the world (most are in the Philippines, others in the US, Africa, Australia and beyond).",
  `Write 1 to 3 short sentences (at most ${maxChars - 20} characters in total): echo the reel's hook in fresh words, give one concrete, useful takeaway from the script, and end with one genuine open question moms would want to answer from their own life.`,
  "When the prompt gives a key phrase, repeat it word for word (without quotation marks, e.g. after a colon) or name the method's name, so the post is worth saving; if the phrase uses I, me, my, we, us or our, name the method's name or the takeaway instead. The question is honest and about this topic, never bait.",
  "Simple, warm English anyone understands, with normal capitalization and no region-specific slang, in everyday words a busy mom gets at a glance. Not salesy, no cliches, no lecturing, no jargon (never name a technique, therapy, study or brain part such as affect labeling, PCIT, serve and return, co-regulation, amygdala or cortisol).",
  "Never a Filipino or Tagalog word or Taglish (no anak, lola, naman, talaga, kasi, lang, mga, OFW): say Grandma, not lola.",
  "This is a brand page, not a person: speak to the mom in the second person (\"you\", \"your little one\"). Never claim personal experience or feelings (no \"I really felt that\", no \"it helped us\"): never use the words I, me, my, we, us or our.",
  "Exactly one question, at the very end. Never engagement bait: no \"comment YES\", \"tag a friend\" or \"tag a mom\", \"share if\", \"like if\", \"drop a heart\", \"in the comments\"; never \"follow us\", \"follow for more\" or any other call to follow, like or share.",
  "It must read clearly different from the recent captions in the prompt: a different opening word, a different sentence shape and a different question. Never reuse their phrases.",
  "At most one emoji, or none. No hashtags in the caption, no @mentions, no links, no quotation marks.",
  "Also suggest 3 to 5 hashtags about this reel's specific topic, best first (for example #toddlertantrums, #gentleparenting, #momtips): lowercase letters and digits only, at most 24 characters each, never #fyp, #foryou, #follow..., #viral or other bait, no other platforms' tags (#momsoftiktok, #instagood...), and different from the recent hashtags.",
  "Return JSON: {\"caption\": \"...\", \"tags\": [\"#...\"]}.",
].join("\n");

export const UNIQUE_NAMES_CAPTIONS: PackCaptions = { postSystem, styleGuide: STYLE_GUIDE, reelSystem, titleOnly: true, themeFirst: true };
