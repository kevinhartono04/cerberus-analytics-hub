import { shiftDate } from "@/lib/ludios-sense-detection";
import type { SenseGame, SenseRunResponse } from "@/lib/ludios-sense-types";

export const hasSenseSignal = (game: SenseGame) => ["confirmed_momentum", "early_warning"].includes(game.evaluation.signal);

/** Saved detections only: no reconstruction from revised estimates or future reports. */
export function buildSenseWatchlist(current: SenseRunResponse, previous: SenseRunResponse[]): SenseGame[] {
  if (!current.result) return [];
  const detections = new Map<string, { game: SenseGame; first: string; last: string; source: SenseRunResponse }>();
  for (const report of [...previous, current]) {
    if (!report.result || report.result.filters.date > current.result.filters.date ||
      [...report.result.filters.countries].sort().join() !== [...current.result.filters.countries].sort().join()) continue;
    for (const game of report.result.games) {
      const t = current.result.watermarks[game.store];
      const date = game.evaluation.date;
      if (!t || date < shiftDate(t, -6) || date > t || !hasSenseSignal(game) || game.classification !== "included") continue;
      const key = `${game.store}:${game.appId}`, old = detections.get(key);
      if (!old) detections.set(key, { game, first: date, last: date, source: report });
      else {
        old.first = date < old.first ? date : old.first;
        if (date >= old.last) Object.assign(old, { game, last: date, source: report });
      }
    }
  }
  return [...detections.values()].map(({ game: detected, first, last, source }) => {
    const observed = current.result!.games.find(g => g.store === detected.store && g.appId === detected.appId);
    const game = observed ?? { ...detected, evaluation: { ...detected.evaluation, date: current.result!.watermarks[detected.store]!, signal: "insufficient_data" as const, latest: null, recentAverage: null, baseline: null, growth: null, added: null } };
    const reference = detected.evaluation.recentAverage ?? detected.evaluation.latest;
    const status: NonNullable<SenseGame["watch"]>["status"] = !observed || game.evaluation.signal === "insufficient_data" || game.evaluation.latest === null || game.evaluation.recentAverage === null ? "insufficient_data" : hasSenseSignal(game) ? "current_signal" : game.evaluation.latest >= 1000 && reference !== null && game.evaluation.recentAverage >= .8 * reference ? "holding_scale" : "cooling_down";
    return { ...game, history: [], watch: { firstDetected: first, lastDetected: last, referenceAverage: reference, status, sourceJobKey: observed ? current.jobKey : source.jobKey, sourceGeneratedAt: observed ? current.result!.generatedAt : source.result!.generatedAt, currentObserved: Boolean(observed) } };
  }).sort((a, b) => b.watch.lastDetected.localeCompare(a.watch.lastDetected) || (b.evaluation.latest ?? -1) - (a.evaluation.latest ?? -1));
}
