// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
let directory = "";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
it("persists draft and published state in SQLite with atomic revision protection", async () => {
  directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "event-generation-storage-"),
  );
  fs.mkdirSync(path.join(directory, "data"));
  execFileSync("sqlite3", [
    path.join(directory, "data/analytics.sqlite"),
    "CREATE TABLE test_marker (id TEXT);",
  ]);
  for (const key of [
    "CEREBRAL_DATABASE_URL",
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
  ])
    vi.stubEnv(key, "");
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  vi.resetModules();
  const { getEventGenerationRecord, saveEventGenerationRecord } =
    await import("@/lib/db");
  expect(await getEventGenerationRecord()).toBeNull();
  const config = { events: [], sharedFields: [], platformAds: [] };
  const record = {
    revision: 1,
    version: 0,
    draft: config,
    published: config,
    updatedBy: "admin",
    updatedAt: "2026-10-20",
  };
  expect(await saveEventGenerationRecord(record, 0)).toBe(true);
  expect(await saveEventGenerationRecord(record, 0)).toBe(false);
  expect(await getEventGenerationRecord()).toEqual(record);
  const published = { ...record, revision: 2, version: 1 };
  expect(await saveEventGenerationRecord(published, 1)).toBe(true);
  expect(await saveEventGenerationRecord({ ...record, revision: 2 }, 1)).toBe(
    false,
  );
  expect(await getEventGenerationRecord()).toEqual(published);
});
