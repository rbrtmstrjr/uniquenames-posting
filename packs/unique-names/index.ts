import type { NichePack } from "../types";
import { UNIQUE_NAMES_CAPTIONS } from "./captions";
import { UNIQUE_NAMES_CARDS } from "./cards";
import { UNIQUE_NAMES_PDF } from "./pdf";
import { UNIQUE_NAMES_REELS } from "./reels";
import { UNIQUE_NAMES_SHARED } from "./shared";
import { UNIQUE_NAMES_SHOP } from "./shop";
import { UNIQUE_NAMES_SUGGEST } from "./suggest";

/** Unique Names (@unique_names): moms of babies and young kids around the world, most in the Philippines. The default pack. */
export const UNIQUE_NAMES: NichePack = {
  ...UNIQUE_NAMES_SHARED,
  cards: UNIQUE_NAMES_CARDS,
  captions: UNIQUE_NAMES_CAPTIONS,
  suggest: UNIQUE_NAMES_SUGGEST,
  reels: UNIQUE_NAMES_REELS,
  pdf: UNIQUE_NAMES_PDF,
  shop: UNIQUE_NAMES_SHOP,
};
