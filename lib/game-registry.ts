import { defaultGameIds, defaultGameNames, gameInputSchema, type GameSummary } from "@/lib/game-catalog";
import { insertStoredGame, listStoredGames, type StoredGame } from "@/lib/db";

export async function registeredGames(): Promise<GameSummary[]> {
  const stored = await listStoredGames();
  const playMap = environmentMap("GOOGLE_PLAY_APP_MAP_JSON");
  const adjustMap = environmentMap("ADJUST_APP_TOKENS_JSON");
  const records = new Map<string, GameSummary>(defaultGameNames.map(name => [name, {
    name, appId: defaultGameIds[name], bundleId: typeof playMap[name]?.packageName === "string" ? playMap[name].packageName : "",
    adjustAndroidConfigured: Boolean(adjustMap[name]?.android), adjustIosConfigured: Boolean(adjustMap[name]?.ios),
  }]));
  for (const game of stored) records.set(game.name, publicGame(game));
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function publicGame(game: StoredGame): GameSummary {
  return { name: game.name, appId: game.appId, bundleId: game.bundleId, adjustAndroidConfigured: Boolean(game.adjustAndroid), adjustIosConfigured: Boolean(game.adjustIos), createdAt: game.createdAt };
}
export async function storedGame(name: string) { return (await listStoredGames()).find(game => game.name === name); }
export async function gameAppId(name: string): Promise<number> {
  const builtIn = defaultGameIds[name as keyof typeof defaultGameIds];
  if (Number.isSafeInteger(builtIn) && builtIn > 0) return builtIn;
  const game = await storedGame(name);
  if (!game) throw new Response(JSON.stringify({ error: "Unknown game" }), { status: 400, headers: { "Content-Type": "application/json" } });
  return game.appId;
}
export async function addGame(input: unknown, actor: string): Promise<GameSummary> {
  const parsed = gameInputSchema.parse(input);
  const current = await registeredGames();
  if (current.some(game => game.name === parsed.name || game.appId === parsed.appId || game.bundleId === parsed.bundleId)) throw conflict();
  const game = { ...parsed, createdAt: new Date().toISOString(), createdBy: actor };
  try { await insertStoredGame(game); } catch (error) {
    if ((error as { code?: string }).code === "23505" || /UNIQUE constraint failed/.test(String(error))) throw conflict();
    throw error;
  }
  return publicGame(game);
}
function conflict() { return new Response(JSON.stringify({ error: "A game with this name, app ID, or bundle ID already exists" }), { status: 409, headers: { "Content-Type": "application/json" } }); }

function environmentMap(key: string): Record<string, Record<string, string>> {
  try {
    const value = JSON.parse(process.env[key] || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
