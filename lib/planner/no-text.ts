// Z-Image runs without a negative prompt (cfg 1): naming an unwanted object (a camera, a
// stand, a paper roll) can summon it, so prompts only describe what should be there.
// "No text" is the one exception and has proven safe. A leaf module: the reel prompt builder (which the review page
// also loads in the browser) imports it without pulling in the card planner and its niche pack.
export const NO_TEXT = "No text, no letters, no words, no logo, no watermark anywhere.";
