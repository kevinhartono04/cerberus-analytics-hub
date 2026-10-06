import { z } from "zod";

export const defaultGameNames = [
  "hexago",
  "hexastack",
  "marble",
  "marbledrop",
  "tripletile",
  "wooblast",
  "woodoku",
  "blockkingdom",
  "bubblego",
  "mahjongbloom",
  "wordblast",
  "wordoku",
  "jelly",
  "bloomsort",
  "wordrush",
  "sizzle",
  "stacksmash",
  "treasureshot",
  "dotpaint",
  "bubblewordchain",
  "ringtangle",
] as const;

// App names are the user-facing filter contract; query builders resolve them
// to immutable source IDs before generating SQL so Snowflake can prune early.
export const defaultGameIds: Record<(typeof defaultGameNames)[number], number> = {
  hexago: 18,
  hexastack: 3008,
  marble: 22,
  marbledrop: 3007,
  tripletile: 9,
  wooblast: 28,
  woodoku: 4,
  blockkingdom: 117,
  bubblego: 23,
  mahjongbloom: 119,
  wordblast: 122,
  wordoku: 3013,
  jelly: 125,
  bloomsort: 3003,
  wordrush: 3001,
  sizzle: 3004,
  stacksmash: 3011,
  treasureshot: 3012,
  dotpaint: 3005,
  bubblewordchain: 3006,
  ringtangle: 3015,
};


export const gameNameSchema = z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_-]*$/, "Use a lowercase game key");
export const gameInputSchema = z.object({
  name: gameNameSchema,
  appId: z.number().int().positive().max(2147483647),
  bundleId: z.string().trim().min(3).max(255).regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/, "Enter a valid bundle ID"),
  adjustAndroid: z.string().trim().max(128).regex(/^[a-zA-Z0-9]*$/, "Use the Android app token").default(""),
  adjustIos: z.string().trim().max(128).regex(/^[a-zA-Z0-9]*$/, "Use the iOS app token").default(""),
});
export type GameInput = z.infer<typeof gameInputSchema>;
export type GameSummary = { name: string; appId: number; bundleId: string; adjustAndroidConfigured: boolean; adjustIosConfigured: boolean; createdAt?: string };
export function validatedGameId(name: string, resolvedId?: number) {
  const id = resolvedId ?? defaultGameIds[name as keyof typeof defaultGameIds];
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Unknown game: " + name);
  return id;
}

export function isDefaultGameId(id: number) { return Object.values(defaultGameIds).some(value => value === id); }
