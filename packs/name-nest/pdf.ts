import type { PackPdf } from "../types";
import { NAME_NEST_PALETTE } from "./shared";

// Name Nest (@namenest): the sellable names PDF (Names > Export PDF). Warm American English for US moms and dads,
// US Letter, strawberry red & cream with the nest-and-strawberry mark.

export const NAME_NEST_PDF: PackPdf = {
  pageSize: "LETTER",
  collection: "The Name Nest Collection",
  titles: { girl: "Baby Girl Names", boy: "Baby Boy Names", both: "Baby Girl & Boy Names" },
  subtitle: "Hand-picked names and their meanings, gathered in one cozy place to help you find the one.",
  genderLabels: { girl: "Girl Names", boy: "Boy Names" },
  styles: {
    single: { title: "Single Names", intro: "First names that stand on their own, grouped by what they mean." },
    "two-word": { title: "First & Middle Combos", intro: "First and middle names that sound sweet together, grouped by meaning." },
  },
  welcome: {
    heading: "Welcome to the nest",
    intro: "Thank you for picking up The Name Nest Collection. Inside you'll find {count} names from our list, each with its meaning. We hope your baby's name is waiting somewhere in these pages.",
    insideHeading: "What's inside",
    inside: [
      "Single names first, then first & middle combos.",
      "Names grouped by meaning: nature, light, faith, love, strength and more.",
      "The meaning of every name, A to Z in each group, with its origin when we know it.",
    ],
    tipsHeading: "How to find “the one”",
    tips: [
      { title: "Start a short list", text: "Circle every name you love on the first pass, no overthinking. Then narrow it down to your top five." },
      { title: "Say it out loud", text: "Try each name with your last name, next to a sibling's name, and the way you'd call it across the playground." },
      { title: "Check the initials", text: "Write out the initials and think through the nicknames, so there are no surprises later." },
      { title: "Look at the meaning", text: "A name is a little wish for your child. Pick a meaning that feels like your family." },
      { title: "Give it a week", text: "Live with your top picks for a few days. The one you keep coming back to is usually the one." },
    ],
    trustHeading: "About this list",
    trust: "Every name here was hand-picked and checked by the {page} team, the same list we share with families on our page. Where we know a name's origin, you'll see it in a small tag next to the name.",
  },
  contentsHeading: "Contents",
  copyright: "© {year} {page}. For personal use by {buyer} only. Please don't share or resell this list.",
  thanks: {
    heading: "Thank you!",
    lines: [
      "We hope you found a name that makes your heart skip a beat.",
      "When you pick the one, we'd love to hear it.",
    ],
    follow: "Follow {handle} on Facebook for fresh name ideas every day.",
  },
  colors: {
    paper: "#FAF4EC", ink: NAME_NEST_PALETTE.ink, muted: "#765B57", accent: NAME_NEST_PALETTE.berry, accentSoft: "#F5E1DD",
    line: NAME_NEST_PALETTE.blush, leaf: NAME_NEST_PALETTE.leaf,
  },
  fonts: { display: "DMSerifDisplay-Regular.ttf", body: "Nunito-Regular.ttf", bodyBold: "Nunito-Bold.ttf" },
  logo: "nest",
  ornament: "berry",
};
