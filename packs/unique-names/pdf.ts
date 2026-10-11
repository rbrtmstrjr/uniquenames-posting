import type { PackPdf } from "../types";

// Unique Names (@unique_names): the sellable names PDF (Names > Export PDF). Simple global English for moms around the
// world, most in the Philippines: short sentences, no slang, no Tagalog. A4, the page's warm beige and brown.

export const UNIQUE_NAMES_PDF: PackPdf = {
  pageSize: "A4",
  collection: "The Unique Names Collection",
  titles: { girl: "Baby Girl Names", boy: "Baby Boy Names", both: "Baby Girl & Boy Names" },
  subtitle: "Beautiful, rare names and their meanings, gathered with love to help you find the one for your little one.",
  scriptLine: "with love",
  genderLabels: { girl: "Girl Names", boy: "Boy Names" },
  styles: {
    single: { title: "Single Names", intro: "One beautiful name, short and sweet. Grouped by what the name means." },
    "two-word": { title: "Combo Names", intro: "A first name and a middle name that sound lovely together. Grouped by meaning." },
  },
  welcome: {
    heading: "Welcome!",
    intro: "Thank you for choosing The Unique Names Collection. Inside are {count} names from our page, each with a short, simple meaning. We hope one of them becomes your baby's name.",
    insideHeading: "What's inside",
    inside: [
      "Single names first, then combo names (a first name and a middle name).",
      "Names grouped by meaning: nature, light, faith, love, strength and more.",
      "A short meaning under every name, from A to Z in each group.",
    ],
    tipsHeading: "How to find “the one”",
    tips: [
      { title: "Make a short list", text: "On your first read, mark every name you love. Don't think too long. Then choose your top five." },
      { title: "Say it out loud", text: "Say each name with your surname, the way you will call your child at home and at school." },
      { title: "Check the initials", text: "Write down the initials. Make sure they don't spell a word you don't want." },
      { title: "Read the meaning", text: "A name is a wish for your child. Choose a meaning that feels right for your family." },
      { title: "Give it a few days", text: "Keep your top names for a few days. The name you keep coming back to is often the one." },
    ],
    trustHeading: "About this list",
    trust: "Every name in this collection was chosen and checked by the {page} team. They are the same kind of names we share with parents on our page every day, and every meaning is written in simple words.",
  },
  contentsHeading: "Contents",
  copyright: "© {year} {page}. For personal use by {buyer} only. Please don't share or resell this list.",
  thanks: {
    heading: "Thank you!",
    lines: [
      "We hope you found a name that makes your heart smile.",
      "When you choose your baby's name, we would love to hear it.",
    ],
    follow: "Follow {handle} on Facebook for new names every day.",
  },
  colors: {
    paper: "#FBF6EF", ink: "#3B2A20", muted: "#75604F", accent: "#8A5A3B", accentSoft: "#F1E4D6", line: "#E3D3C1", leaf: "#8C9A6B",
  },
  fonts: { display: "PlayfairDisplay-VF.ttf", body: "Poppins-Regular.ttf", bodyBold: "Poppins-SemiBold.ttf", script: "GreatVibes-Regular.ttf" },
  logo: "flower",
  ornament: "sprig",
};
