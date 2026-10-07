import type { ReelMotion } from "@/lib/db/types";
import { emotionOf, shotOf, type ReelEmotion, type ReelShot } from "./motion";
import { sizeOf, type ReelShotSize } from "./shots";

// Words for the review page's per-line chips (read-only): the feeling, the shot size, the framing and the camera move.

export const EMOTION_EMOJI: Record<ReelEmotion, string> = {
  laughing: "😂", playful: "😜", surprised: "😮", curious: "🤔", determined: "💪", proud: "🥹",
  relieved: "😌", tender: "🥰", cuddly: "🤗", teary: "😢", worried: "😟", exhausted: "😩",
};
/** The 007 framings (older lines). */
export const SHOT_LABEL: Record<ReelShot, string> = {
  wide: "Wide", medium: "Medium", "over-the-shoulder": "Over the shoulder", "low-angle": "Low angle",
  "hands-detail": "Hands detail", "eye-level": "Eye level",
};
/** The 008 shot sizes (the chip on every line). */
export const SHOT_SIZE_LABEL: Record<ReelShotSize, string> = {
  wide: "Wide", medium: "Medium", close: "Close-up", detail: "Detail", pov: "POV", broll: "B-roll",
};
export const MOTION_LABEL: Record<ReelMotion, string> = {
  push_in: "Push in", pull_out: "Pull back", pan_left: "Pan left", pan_right: "Pan right",
  tilt_up: "Tilt up", tilt_down: "Tilt down", punch: "Punch", hold: "Hold",
};

/** What a line's chips show; null when the line has neither a feeling (007) nor a shot size (008). */
export function lineMood(s: {
  emotion?: string | null; shot?: string | null; motion?: string | null; key_moment?: boolean | null;
  shot_size?: string | null; punch?: string | null;
}) {
  const emotion = emotionOf(s.emotion);
  const size = sizeOf(s.shot_size);
  if (!emotion && !size) return null;
  const shot = shotOf(s.shot);
  const motion = s.motion && s.motion in MOTION_LABEL ? MOTION_LABEL[s.motion as ReelMotion] : null;
  const punch = typeof s.punch === "string" && s.punch.trim() ? s.punch.trim() : null;
  return {
    emotion, emoji: emotion ? EMOTION_EMOJI[emotion] : null,
    size: size ? SHOT_SIZE_LABEL[size] : null, shot: shot ? SHOT_LABEL[shot] : null, motion, punch,
    // 007 key lines; from 008 a punch word marks the stressed beat instead
    key: s.key_moment === true && !punch,
  };
}
