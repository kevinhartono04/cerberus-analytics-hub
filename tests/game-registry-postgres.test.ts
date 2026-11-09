// @vitest-environment node
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGliteWire } from "./helpers/pglite-wire";

const mock = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("postgres", async importOriginal => {
  const actual = await importOriginal<{ default: typeof postgres }>();
  return { ...actual, default: (...args: unknown[]) => args.length === 1 ? actual.default(args[0] as never) : mock.client };
});
import { getEventGenerationRecord, saveEventGenerationRecord } from "@/lib/db";
import { seedGenerationConfig } from "@/lib/event-generation-config";
import { getLibrarySnapshot } from "@/lib/db";
import { addGame, editGame, gameAppId, storedGame } from "@/lib/game-registry";

let pg: PGlite;
let client: ReturnType<typeof postgres>;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("CREATE ROLE cerebral_app; CREATE SCHEMA cerebral AUTHORIZATION cerebral_app; SET ROLE cerebral_app; SET search_path TO cerebral,public");
  const options = { max: 1, prepare: false, fetch_types: true, socket: () => new PGliteWire(pg) };
  client = postgres(options);
  mock.client = client;
  vi.stubEnv("CEREBRAL_DATABASE_URL", "postgres://fixture@localhost/test");
});
afterAll(async () => { await client?.end({ timeout: 1 }); await pg?.close(); vi.unstubAllEnvs(); });

it("edits the private registry through the production Postgres driver, preserving and removing tokens atomically", async () => {
  const first = await addGame({ name: "pgtestgame", appId: 990020, bundleId: "com.example.pgtest", adjustAndroid: "savedandroid", adjustIos: "savedios" }, "editor");
  const updated = await editGame(first.name, { appId: 990021, bundleId: "com.example.pgupdated", adjustAndroid: "replacement", clearAdjustIos: true });
  expect(updated).toMatchObject({ appId: 990021, adjustAndroidConfigured: true, adjustIosConfigured: false, createdAt: first.createdAt });
  expect(JSON.stringify(updated)).not.toContain("replacement");
  await editGame(first.name, { appId: 990021, bundleId: "com.example.pgupdated", adjustAndroid: "", adjustIos: "" });
  expect(await storedGame(first.name)).toMatchObject({ adjustAndroid: "replacement", adjustIos: "", createdBy: "editor" });
  expect(await gameAppId(first.name)).toBe(990021);
  await expect(editGame(first.name, { appId: 3015, bundleId: "com.example.pgupdated" })).rejects.toHaveProperty("status", 409);
  expect((await pg.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='cerebral.game_registry'::regclass")).rows[0].relrowsecurity).toBe(true);
}, 15000);


it("persists admin draft and publication with revision checks in private Postgres storage", async () => {
  expect(await getEventGenerationRecord()).toBeNull();
  const config = seedGenerationConfig(getLibrarySnapshot());
  const record = { revision: 1, version: 0, draft: config, published: config, updatedBy: "admin", updatedAt: "2026-11-09" };
  expect(await saveEventGenerationRecord(record, 0)).toBe(true);
  expect(await saveEventGenerationRecord(record, 0)).toBe(false);
  expect(await getEventGenerationRecord()).toEqual(record);
  expect(await saveEventGenerationRecord({ ...record, revision: 2, version: 1 }, 1)).toBe(true);
  expect(await saveEventGenerationRecord({ ...record, revision: 2 }, 1)).toBe(false);
  expect((await getEventGenerationRecord())?.version).toBe(1);
  expect((await pg.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='cerebral.event_generation_settings'::regclass")).rows[0].relrowsecurity).toBe(true);
});
