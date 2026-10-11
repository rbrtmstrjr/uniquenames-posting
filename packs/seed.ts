import type { PackShared } from "./types";

/**
 * The settings a NEW Supabase project for this pack should start with (the seed step writes them over the
 * supabase/schema.sql column defaults, which are the Unique Names values). Until then the app prefers the pack's
 * values wherever a setting is missing or empty: hashtags, closing-card messages and the watermark handle.
 */
export function settingsSeed(p: PackShared) {
  return {
    caption_template: p.captionTemplate,
    handle: p.brand.handle,
    hashtags_always: p.hashtags.always,
    hashtag_pool: p.hashtags.pool,
    cta_messages: p.ctaMessages,
    reel_voice_id: p.voices.default,
    title_font: p.cardText.titleFont,
    meaning_font: p.cardText.meaningFont,
    mark_font: p.cardText.markFont,
    card_layout: p.cardText.layout,
  };
}
