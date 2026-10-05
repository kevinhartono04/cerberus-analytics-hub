import type { SenseGame } from "@/lib/ludios-sense-types";

/** Display-only cleanup. Preserve the full source categories for classification and detail. */
export function senseTableGenres(games: SenseGame[]): string {
  return [...new Set(games.flatMap(game => game.genre.split(",").map(value => value.trim())
    .filter(value => !/^(games?|entertainment)$/i.test(value))
    .map(value => game.store === "ios" ? value.replace(/^games?\s*\/\s*/i, "") : value)
    .filter(Boolean)))].join(" · ");
}

/** Only Sensor Tower's verified unified IDs can join store apps; never guess from names. */
export function groupSenseGames(games: SenseGame[], unifiedIds: Record<string,string|null> = {}) {
  const groups = new Map<string,SenseGame[]>();
  for (const game of games) {
    const storeKey = `${game.store}:${game.appId}`;
    const unified = game.unifiedAppId ?? unifiedIds[storeKey];
    const key = unified ? `unified:${unified}` : storeKey;
    const members = groups.get(key) ?? [];
    members.push(game); groups.set(key,members);
  }
  // Preserve signal ordering and each member's independent store metrics.
  return [...groups.entries()].map(([key,members]) => ({key,members}));
}

export const senseCurrentSignal = (game: SenseGame) => game.classification === "included" &&
  (game.evaluation.signal === "confirmed_momentum" || game.evaluation.signal === "early_warning");
export const senseWorthAttention = (game: SenseGame) => senseCurrentSignal(game) ||
  game.classification === "included" && game.watch?.status === "holding_scale";

/** Presentation ordering only; store estimates and detector results stay independent. */
export function senseAttentionRank(game: SenseGame) {
  if (senseCurrentSignal(game)) return game.evaluation.signal === "confirmed_momentum" ? 0 : 1;
  if (game.classification === "included" && game.watch?.status === "holding_scale") return 2;
  return 3;
}
export function compareSenseAttention(a: SenseGame, b: SenseGame) {
  const rank = senseAttentionRank(a) - senseAttentionRank(b);
  if (rank) return rank;
  const metric = senseAttentionRank(a) === 2 ? "latest" : "added";
  return (b.evaluation[metric] ?? -Infinity) - (a.evaluation[metric] ?? -Infinity) ||
    `${a.store}:${a.appId}`.localeCompare(`${b.store}:${b.appId}`);
}
export function sortSenseGroups(groups: ReturnType<typeof groupSenseGames>) {
  return groups.map(group => ({ ...group, members: [...group.members].sort(compareSenseAttention) }))
    .sort((a,b) => compareSenseAttention(a.members[0],b.members[0]) || a.key.localeCompare(b.key));
}
