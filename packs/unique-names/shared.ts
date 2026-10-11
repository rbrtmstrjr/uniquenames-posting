import type { PackShared } from "../types";

// Unique Names (@unique_names), the client-safe part: brand, default hashtags, closing-card messages and voices.
// Every value is today's live value, word for word (tests/pack-snapshots + tests/packs prove it).

export const UNIQUE_NAMES_SHARED: PackShared = {
  id: "unique-names",
  brand: {
    name: "Unique Names",
    description: "Daily name-card posts",
    mark: "✿",
    handle: "@unique_names",
    loginTagline: "Welcome back to the studio",
    loginFooter: "Every name is a blessing ✿",
    postReadyText: "Your Unique Names cards are done.",
    zipPrefix: "unique-names",
    pcFolder: "Unique Names",
    postingTimeHint: "",
    assets: {
      icon: "/icon.svg",
      login: {
        lightWide: "/login/light-wide.webp", lightTall: "/login/light-tall.webp",
        darkWide: "/login/dark-wide.webp", darkTall: "/login/dark-tall.webp",
      },
      loginColor: { light: "#EFE3D2", dark: "#3A2418" },
    },
    // The same values as app/globals.css (its fallbacks): warm beige light, warm brown accent.
    colors: {
      light: {
        bg: "#FBF6EF", surface: "#FFFFFF", "surface-2": "#F5EDE3", line: "#EADFD2",
        ink: "#3B2A20", muted: "#75604F", accent: "#8A5A3B", "accent-ink": "#FFFFFF", "accent-soft": "#F1E4D6",
      },
      dark: {
        bg: "#0F0E0D", surface: "#191715", "surface-2": "#24201C", line: "#2A2622",
        ink: "#F1ECE6", muted: "#9A9087", accent: "#E8A87C", "accent-ink": "#1A1009", "accent-soft": "#2E241C",
      },
      themeColor: { light: "#FBF6EF", dark: "#0F0E0D" },
    },
  },
  captionTemplate: "Here are some beautiful names you can give to your baby {gender}. 🥰",
  hashtags: {
    always: "#uniquenames",
    pool: "#babynames #babygirlnames #babyboynames #uniquebabynames #namemeaning #momlife #newmom #pregnancy #momtobe #babynameideas",
  },
  // The column default of settings.cta_messages (supabase/migrations/010_cta_card.sql).
  ctaMessages: [
    "Follow for more / baby name ideas.",
    "Follow us for a new / name list every day.",
    "Still searching? Follow for / more unique names.",
    "Save this post and follow / for more name ideas.",
    "More {gender} names tomorrow. / Follow so you don't miss them.",
    "Found a favorite? / Follow for more like it.",
    "Follow for a fresh list / of unique {gender} names.",
    "New names every day. / Follow along!",
  ].join("\n"),
  // The house voices (worker voice.HOUSE_VOICES), Gacrux first and the default.
  voices: {
    house: [
      { id: "gacrux", label: "Gacrux", tone: "Mature" },
      { id: "sulafat", label: "Sulafat", tone: "Warm" },
      { id: "vindemiatrix", label: "Vindemiatrix", tone: "Gentle" },
      { id: "achernar", label: "Achernar", tone: "Soft" },
    ],
    default: "gacrux",
  },
  // The supabase/schema.sql column defaults (the live project keeps its own rows).
  cardText: { titleFont: "poppins", meaningFont: "poppins", markFont: "poppins", layout: "classic" },
  namePicker: { order: "oldest" },
  // The names PDF's meaning groups (migration 018), in simple global English.
  nameCategories: {
    nature: "Nature & Flowers", light: "Light, Sun & Stars", water: "Water & Sea", strength: "Strength & Courage",
    faith: "Faith & Blessing", love: "Love & Joy", wisdom: "Wisdom & Grace", royal: "Royal & Noble", peace: "Peace & Calm",
    gems: "Gems & Beauty", earth: "Earth & Seasons", more: "More Beautiful Names",
  },
};
