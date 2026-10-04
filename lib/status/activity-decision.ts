// Pure decision for one activity load, so out-of-order or failed loads can
// never fake a "Post ready" or leave a stale "Generating" pill.
export interface LoadDecision { apply: boolean; finished: string | null; nextLastActive: string | null }

export function decideLoad(i: {
  seq: number; latestSeq: number; errored: boolean; lastActive: string | null; generatingPostId: string | null;
}): LoadDecision {
  // Stale result or failed query: change nothing (lastActive stays as is).
  if (i.seq !== i.latestSeq || i.errored) return { apply: false, finished: null, nextLastActive: i.lastActive };
  if (i.generatingPostId) return { apply: true, finished: null, nextLastActive: i.generatingPostId };
  return { apply: true, finished: i.lastActive, nextLastActive: null };
}
