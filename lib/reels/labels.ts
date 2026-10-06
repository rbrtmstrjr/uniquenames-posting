import type { ReelMotion } from "@/lib/db/types";
import { emotionOf, shotOf, type ReelEmotion, type ReelShot } from "./motion";

// Words for the review page's per-line chips (read-only): the feeling, the framing and the camera move.

export const EMOTION_EMOJI: Record<ReelEmotion, string> = {
  laughing: "😂", playful: "😜", surprised: "😮", curious: "🤔", determined: "💪", proud: "🥹",
  relieved: "😌", tender: "🥰", cuddly: "🤗", teary: "😢", worried: "😟", exhausted: "😩",
};
export const SHOT_LABEL: Record<ReelShot, string> = {
  wide: "Wide", medium: "Medium", "over-the-shoulder": "Over the shoulder", "low-angle": "Low angle",
  "hands-detail": "Hands detail", "eye-level": "Eye level",
};
export const MOTION_LABEL: Record<ReelMotion, string> = {
  push_in: "Push in", pull_out: "Pull back", pan_left: "Pan left", pan_right: "Pan right",
  tilt_up: "Tilt up", tilt_down: "Tilt down", punch: "Punch",
};

/** What a line's chip shows; null when the line has no emotion (written before 007). */
export function lineMood(s: { emotion?: string | null; shot?: string | null; motion?: string | null; key_moment?: boolean | null }) {
  const emotion = emotionOf(s.emotion);
  if (!emotion) return null;
  const shot = shotOf(s.shot);
  const motion = s.motion && s.motion in MOTION_LABEL ? MOTION_LABEL[s.motion as ReelMotion] : null;
  return { emotion, emoji: EMOTION_EMOJI[emotion], shot: shot ? SHOT_LABEL[shot] : null, motion, key: s.key_moment === true };
}
