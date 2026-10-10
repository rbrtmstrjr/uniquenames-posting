import type { PackShared } from "../types";

// Name Nest – Baby Names & Parenting (@namenest), the client-safe part: brand, default hashtags, closing-card messages,
// voices and the card text a new project starts with. A US-only page (docs/superpowers/specs/
// 2026-10-10-niche-packs-name-nest-design.md): strawberry red & cream, never Unique Names' texts, tags or looks.

/** The brand palette (owner, 2026-10-10). */
export const NAME_NEST_PALETTE = {
  berry: "#A8323A", deep: "#8E272F", cream: "#F6EEE4", blush: "#E8D6D0", leaf: "#4F7A4A", ink: "#2B1E1E",
} as const;

export const NAME_NEST_SHARED: PackShared = {
  id: "name-nest",
  brand: {
    name: "Name Nest",
    description: "Baby names & parenting posts for Name Nest",
    mark: "♡",
    handle: "@namenest",
    loginTagline: "Welcome back to the nest",
    loginFooter: "Every name tells a story ♡",
    postReadyText: "Your Name Nest cards are done.",
    zipPrefix: "name-nest",
    pcFolder: "Name Nest",
    // US daylight time until Nov 1 2026; the owner posts from the Philippines (docs/SETUP-NAME-NEST.md).
    postingTimeHint: "Best times for US moms: 9–10 pm, 12–2 am, 7–9 am PH time (+1 h after Nov 1)",
    assets: {
      icon: "/packs/name-nest/icon.svg",
      // The nest-and-strawberry mark (public/packs/name-nest/logo.svg is the full logo with the wordmark, for the page).
      logo: "/packs/name-nest/mark.svg",
      login: {
        lightWide: "/packs/name-nest/login-light-wide.svg", lightTall: "/packs/name-nest/login-light-tall.svg",
        darkWide: "/packs/name-nest/login-dark-wide.svg", darkTall: "/packs/name-nest/login-dark-tall.svg",
      },
      loginColor: { light: "#F6EEE4", dark: "#241617" },
    },
    // Strawberry red & cream: cream light theme with a berry accent; a warm near-black dark theme with a lifted berry.
    colors: {
      light: {
        bg: "#FAF4EC", surface: "#FFFFFF", "surface-2": "#F4EAE1", line: "#E8D6D0",
        ink: "#2B1E1E", muted: "#765B57", accent: "#A8323A", "accent-ink": "#FFFFFF", "accent-soft": "#F5E1DD",
      },
      dark: {
        bg: "#120C0C", surface: "#1C1414", "surface-2": "#271B1B", line: "#332424",
        ink: "#F6EEE4", muted: "#A9958F", accent: "#E8838A", "accent-ink": "#1F0B0D", "accent-soft": "#3A1F22",
      },
      themeColor: { light: "#FAF4EC", dark: "#120C0C" },
    },
  },
  captionTemplate: "Sweet baby {gender} names for your short list. 🍓",
  hashtags: {
    always: "#namenest",
    pool: "#babynameideas #babynamesearch #namemeaning #girlnames #boynames #momtobe #expectingmom #firsttimemom #newmom #momlife #parentingtips #toddlermom",
  },
  // Eight follow lines in a warm American voice; never "like", "share" or "comment" bait.
  ctaMessages: [
    "Still making your list? / Follow along for more.",
    "Follow Name Nest / for names with meaning.",
    "Your short list starts here. / Follow for more picks.",
    "Fresh {gender} names / land in the nest tomorrow.",
    "Found the one? / Follow for more sweet picks.",
    "Names, meanings and mom tips. / Follow the nest.",
    "Pull up a chair, mama. / Follow for daily name ideas.",
    "More {gender} names are on the way. / Follow so you catch them.",
  ].join("\n"),
  // The same house voices (every Gemini voice speaks American English); Sulafat ("Warm") is the default narrator.
  voices: {
    house: [
      { id: "sulafat", label: "Sulafat", tone: "Warm" },
      { id: "gacrux", label: "Gacrux", tone: "Mature" },
      { id: "vindemiatrix", label: "Vindemiatrix", tone: "Gentle" },
      { id: "achernar", label: "Achernar", tone: "Soft" },
    ],
    default: "sulafat",
  },
  // A warm serif name over a clean rounded sans (Unique Names: Poppins), stamped in the Name Nest layout.
  cardText: { titleFont: "dmserif", meaningFont: "nunito", markFont: "nunito", layout: "name-nest" },
};
