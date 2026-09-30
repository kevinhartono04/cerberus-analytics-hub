import mapping from "@/data/ludios-sense/genre-map.json";
import type { SenseCountry, SenseEvaluation, SensePoint, SenseStore } from "@/lib/ludios-sense-types";

export const senseRuleVersion = "1.4-aggregate";
export const shiftDate = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export const validDownloads = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Fixed country basket across the lookback; missing values never become zero. */
export function aggregateSenseHistory(histories: Partial<Record<SenseCountry, Record<string, number | null>>>, countries: SenseCountry[], t: string) {
  const dates = Array.from({ length: 28 }, (_, i) => shiftDate(t, i - 27));
  const availableCountries = countries.filter(c => dates.some(d => validDownloads(histories[c]?.[d])));
  const unavailableCountries = countries.filter(c => !availableCountries.includes(c));
  const history: SensePoint[] = dates.map(date => {
    const values = availableCountries.map(c => histories[c]?.[date]);
    return { date, downloads: values.length && values.every(validDownloads) ? values.reduce((a, b) => a + b, 0) : null };
  });
  return { history, availableCountries, unavailableCountries };
}

export function classifySense(appId: string, store: SenseStore, categories: string[]) {
  const overrides = mapping.overrides as Record<string, { status: "included" | "review" | "excluded"; genre: string }>;
  const override = overrides[store + ":" + appId];
  const cats = mapping.categories as Record<string, { genre: string; status: "included" | "review" }>;
  const names = mapping.category_ids[store] as Record<string, string>;
  const matched = categories.map(c => cats[c.toUpperCase()]).filter(Boolean);
  const accepted = matched.find(c => c.status === "included") ?? matched[0];
  const game = categories.some(c => c === "6014" || /^70\d\d$/.test(c) || /^game(?:_|$)/i.test(c));
  return {
    classification: override?.status ?? accepted?.status ?? (game || !categories.length ? "review" : "excluded"),
    genre: override?.genre ?? (categories.map(c => names[c.toLowerCase()] ?? c).join(", ") || "Genre review needed"),
  };
}

/** Same growth gates as the local v1.3 detector, applied to one combined series. */
export function evaluateSense(history: SensePoint[], t: string, release: string | null): SenseEvaluation {
  const values = new Map(history.filter(p => p.date <= t && validDownloads(p.downloads)).map(p => [p.date, p.downloads as number]));
  const x = (i: number): number | null => values.get(shiftDate(t, -i)) ?? null;
  const avg = (offsets: number[]) => { const v = offsets.map(x); return v.every(validDownloads) ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const range = (start: number, end: number) => Array.from({ length: end - start }, (_, i) => i + start);
  const d = x(0), r = avg(range(0, 3)), b1 = avg(range(1, 8)), b3 = avg(range(3, 10));
  const s1 = avg([7, 14, 21]), s3 = avg([7, 14, 21, 8, 15, 22, 9, 16, 23]);
  const B1 = b1 === null ? null : Math.max(b1, s1 ?? b1), B3 = b3 === null ? null : Math.max(b3, s3 ?? b3);
  const short1 = avg([1, 2, 3]), short3 = avg([3, 4, 5]);
  const earlyBase = B1 ?? short1 ?? x(1);
  const earlyVariant = B1 !== null ? "ordinary" : short1 !== null ? "short_history" : "traction_two_day";
  const early = d !== null && earlyBase !== null && d >= 1000 && d >= (earlyVariant === "traction_two_day" ? 1.5 : 2) * earlyBase && d - earlyBase >= 500;
  const confirmedBase = B3 ?? short3 ?? x(2);
  const confirmedVariant = B3 !== null ? "ordinary" : short3 !== null ? "short_history" : "traction_three_day";
  const confirmed = r !== null && d !== null && confirmedBase !== null && r >= 1000 && (confirmedVariant === "traction_three_day"
    ? d >= 1.5 * confirmedBase && d - confirmedBase >= 500 && d >= (x(1) ?? Infinity)
    : r >= 2 * confirmedBase && r - confirmedBase >= 500 && [0, 1, 2].filter(i => (x(i) ?? -1) >= 1.5 * confirmedBase).length >= 2 && d >= 1000 && d >= .8 * r);
  const signal = confirmed ? "confirmed_momentum" : early ? "early_warning" : values.size === 1 && (d ?? 0) >= 1000 ? "launch_traction" : d === null || earlyBase === null || r === null || confirmedBase === null ? "insufficient_data" : "none";
  const variant = confirmed ? confirmedVariant : early ? earlyVariant : null;
  const baseline = confirmed ? confirmedBase : early ? earlyBase : null;
  const value = confirmed && confirmedVariant !== "traction_three_day" ? r : d;
  const flags: string[] = [];
  if (variant !== null && variant !== "ordinary") flags.push("short_history", "seasonality_unchecked");
  if (variant === "ordinary" && (confirmed ? s3 === null : s1 === null)) flags.push("seasonality_unchecked");
  if (release && [...values].some(([date, downloads]) => date < release && downloads > 0)) flags.push("downloads_precede_reported_release");
  let activityDate: string | null = null;
  for (let i = 27; i >= 2; i--) {
    if ([i, i - 1, i - 2].every(j => (x(j) ?? -1) >= 100)) {
      activityDate = shiftDate(t, -i);
      if (!range(i + 1, i + 15).every(j => x(j) !== null && x(j)! < 100)) flags.push("traction_onset_unverified");
      break;
    }
  }
  const releaseAge = release && !Number.isNaN(Date.parse(release)) ? Math.floor((Date.parse(t) - Date.parse(release)) / 86400000) : null;
  if (releaseAge !== null && releaseAge < 0) flags.push("invalid_release_date");
  return { date: t, signal, variant, latest: d, recentAverage: r, baseline, growth: baseline !== null && baseline > 0 && value !== null ? value / baseline : null, added: baseline !== null && value !== null ? value - baseline : null, activityDate, releaseAge, flags };
}
