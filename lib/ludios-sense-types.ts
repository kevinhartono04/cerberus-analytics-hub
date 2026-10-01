import { z } from "zod";

export const senseToday = (date = new Date()) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0,10);

export const senseCountries = { US: "United States", JP: "Japan", CA: "Canada", RU: "Russia", DE: "Germany", AU: "Australia", GB: "United Kingdom" } as const;
export type SenseCountry = keyof typeof senseCountries;
export type SenseStore = "ios" | "android";
export const senseCountryCodes = Object.keys(senseCountries) as SenseCountry[];
export const senseRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Choose a valid date").refine(v => v <= senseToday(), "Choose today or an earlier date"),
  countries: z.array(z.enum(["US", "JP", "CA", "RU", "DE", "AU", "GB"])).min(1, "Select at least one country").max(7).transform(v => [...new Set(v)].sort()),
});
export type SenseFilters = z.infer<typeof senseRequestSchema>;
export type SensePoint = { date: string; downloads: number | null };
export type SenseEvaluation = {
  date: string; signal: "confirmed_momentum" | "early_warning" | "launch_traction" | "insufficient_data" | "none";
  variant: string | null; latest: number | null; recentAverage: number | null; baseline: number | null;
  growth: number | null; added: number | null; flags: string[]; activityDate: string | null; releaseAge: number | null;
};
export type SenseGame = {
  appId: string; store: SenseStore; name: string; publisher: string; genre: string; iconUrl?: string | null; unifiedAppId?: string | null;
  classification: "included" | "review" | "excluded"; releaseDate: string | null; url: string;
  history: SensePoint[]; historyLoaded?: boolean;
  availableCountries: SenseCountry[]; unavailableCountries: SenseCountry[];
  evaluation: SenseEvaluation; retrievedAt: string;
};
export type SenseResult = {
  filters: SenseFilters; generatedAt: string; watermarks: Partial<Record<SenseStore, string>>;
  games: SenseGame[]; errors: string[]; requests: number; coverageComplete: boolean; ruleVersion: string;
};
export type SenseRunResponse = { jobKey: string; status: "running" | "completed" | "error"; progress: string; requests: number; result?: SenseResult; error?: string; cached?: boolean; paused?: boolean };
