import type { ReelCast } from "@/lib/db/types";
import { guideScenePrompt, isGuideThemeId, type GuideScene } from "./guide";
import { scenePrompt } from "./prompt";
import type { ReelTheme } from "./themes";

/**
 * A line's image prompt for any theme: Crayon and Red Thread follow the owner's guides (lib/reels/guide), the 8 older
 * themes keep the playbook builder (lib/reels/prompt) so their reels still re-render the same way.
 */
export function imagePrompt(theme: ReelTheme, cast: ReelCast, scene: GuideScene, index: number): string {
  return isGuideThemeId(theme.id) ? guideScenePrompt({ id: theme.id }, cast, scene, index) : scenePrompt(theme, cast, scene, index);
}
