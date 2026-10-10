import type { CardLayout, Gender } from "@/lib/db/types";
import type { Session, ShotSpec } from "@/lib/planner/shots";
import type { CaptionStyle } from "@/lib/captions/styles";
import type { ReelFormat } from "@/lib/reels/formats";
import type { ReelTopic } from "@/lib/reels/topics";

// A niche pack = everything one Facebook page's app does differently (docs/PACKS.md). The engine (lib/*, app/*,
// components/*) reads the active pack; nothing here imports runtime code, so packs stay plain data modules that
// server and browser code alike can load. Type-only imports from the engine are fine (they are erased).

/** The colour tokens of app/globals.css (--bg, --ink, --accent, …) without the leading "--". */
export type ColorTokens = Readonly<Record<string, string>>;

/** The page's identity in the app: names, texts and assets. Client-safe (small, no prompts). */
export interface PackBrand {
  /** The app / page name ("Unique Names"): tab title, sidebar, login heading. */
  name: string;
  /** The <meta name="description"> of the app. */
  description: string;
  /** The small glyph shown before the name in the sidebar and on the login card. */
  mark: string;
  /** The watermark handle stamped on cards when Settings has none. */
  handle: string;
  /** Login card: the line under the heading and the line under the card. */
  loginTagline: string;
  loginFooter: string;
  /** The browser notification when a post's cards are done. */
  postReadyText: string;
  /** Saved zip files are named "<zipPrefix>-<date>-<gender>.zip". */
  zipPrefix: string;
  /** The PC folder under OneDrive\Pictures the worker saves into (shown in help texts; the worker has its own setting). */
  pcFolder: string;
  /** A posting-time hint shown on Today ("" = none). */
  postingTimeHint: string;
  /** Public paths of the app icon and the login backdrop photos (wide = landscape screens, tall = portrait phones). */
  assets: {
    icon: string;
    /** The page's logo mark, an image without words (login card and sidebar, instead of the `mark` glyph); none = the glyph. */
    logo?: string;
    login: { lightWide: string; lightTall: string; darkWide: string; darkTall: string };
    /** Shown while the login photo loads. */
    loginColor: { light: string; dark: string };
  };
  /** The website colour tokens (light + dark) and the browser theme colours. */
  colors: { light: ColorTokens; dark: ColorTokens; themeColor: { light: string; dark: string } };
}

export interface HouseVoice { id: string; label: string; tone: string }

/** The client-safe part of a pack: what Settings, the shell and the login page need in the browser. */
export interface PackShared {
  id: string;
  brand: PackBrand;
  /** The post caption template a new project starts with ({gender} = boy / girl; used when AI captions are off). */
  captionTemplate: string;
  /** Defaults used when the settings row has none (the database defaults are the Unique Names values). */
  hashtags: { always: string; pool: string };
  /** One closing-card message per line ("/" = a line break, {gender} = boy / girl). */
  ctaMessages: string;
  /** The narrators offered (house voices, in order) and the default one. */
  voices: { house: readonly HouseVoice[]; default: string };
  /** The card fonts (catalog ids) and the card layout a new project starts with (settings, migration 015). */
  cardText: { titleFont: string; meaningFont: string; markFont: string; layout: CardLayout };
}

/** Name cards: the children's looks, the photoshoot shot lists and the closing card's moment. */
export interface PackCards {
  /** Babies (newborn, 1 year); one per child, repeated word for word. */
  looks: string[];
  /** The same looks for children of 2 and up (same index = same family look). */
  childLooks: string[];
  /** Share of newborn sessions for posts made before ages existed. */
  newbornShare: number;
  /** Shot lists per session (index 0 = the album cover) and the props-only frames (index 0 = the empty set). */
  shots: Readonly<Record<Session, ShotSpec[]>>;
  propsShots: ShotSpec[];
  /** The closing card's moment per session (the child low in the frame, open backdrop above). */
  ctaMoment: Readonly<Record<Session, string>>;
}

export interface PackCaptions {
  /** The post caption system prompt (`maxChars` = the caption's own limit). */
  postSystem: (maxChars: number) => string;
  /** How each caption style is written. */
  styleGuide: Readonly<Record<CaptionStyle, (g: Gender) => string>>;
  /** The reel caption system prompt. */
  reelSystem: (maxChars: number) => string;
}

export interface PackSuggest {
  /** Name ideas (Names page): system prompt and the default wish when the owner gives none. */
  namesSystem: (meaningWords: { min: number; max: number }) => string;
  namesDefaultVibe: string;
  /** Photoshoot theme ideas. */
  themesSystem: string;
  themesDefaultVibe: string;
  /** Names for a post by letter. */
  letterSystem: string;
}

export interface PackReels {
  /** The script writer's system prompt: audience, tone, language and age focus. */
  scriptSystem: string;
  /** The topic line when the owner leaves the topic blank. */
  autoTopic: string;
  /** Claims a script may state as fact. */
  vettedClaims: readonly string[];
  /** The cast rule for people styles and for the Knitted Doll style (with their example descriptions). */
  castPeople: string;
  castDolls: string;
  /** What each guide style wants from the story. */
  crayonStory: string;
  redThreadStory: string;
  /** The page's name as a greeting-regex alternative (line 1 never opens with it), e.g. "unique names". */
  greetingName: string;
  /** "Suggest topics": system prompt and one line per format telling the AI what a fresh idea looks like. */
  ideasSystem: string;
  formatHints: Readonly<Record<ReelFormat, string>>;
  /** The vetted topic bank (picked when the topic is blank, and the source of bank ideas). */
  topics: ReelTopic[];
  /** What a new narrator voice says in its reference clip (Set up voices). */
  voiceRefText: string;
  /** Red Thread's "stretched" thread: the distance stories it stands for (none = the engine's wording). */
  threadDistance?: string;
}

export interface NichePack extends PackShared {
  cards: PackCards;
  captions: PackCaptions;
  suggest: PackSuggest;
  reels: PackReels;
}
