import type { NichePack } from "../types";
import { NAME_NEST_CAPTIONS } from "./captions";
import { NAME_NEST_CARDS } from "./cards";
import { NAME_NEST_REELS } from "./reels";
import { NAME_NEST_SHARED } from "./shared";
import { NAME_NEST_SUGGEST } from "./suggest";

/** Name Nest – Baby Names & Parenting (@namenest): American moms and dads of babies and kids 0-7, US only. */
export const NAME_NEST: NichePack = {
  ...NAME_NEST_SHARED,
  cards: NAME_NEST_CARDS,
  captions: NAME_NEST_CAPTIONS,
  suggest: NAME_NEST_SUGGEST,
  reels: NAME_NEST_REELS,
};
