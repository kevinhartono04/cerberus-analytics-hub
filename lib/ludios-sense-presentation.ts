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
