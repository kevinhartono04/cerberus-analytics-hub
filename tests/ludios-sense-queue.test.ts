// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
let root: string;
let db: typeof import("@/lib/db");
const key = "sense:v1:" + "a".repeat(64);
const expiresAt = "2099-01-01T00:00:00Z";
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "sense-queue-"));
  mkdirSync(join(root, "data"));
  execFileSync("sqlite3", [join(root,"data/analytics.sqlite"), "PRAGMA user_version=1;"]);
  vi.spyOn(process, "cwd").mockReturnValue(root);
  for (const name of ["CEREBRAL_DATABASE_URL","DATABASE_URL","POSTGRES_URL","POSTGRES_PRISMA_URL","POSTGRES_URL_NON_POOLING"]) vi.stubEnv(name, "");
  vi.resetModules();
  db = await import("@/lib/db");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root,{recursive:true,force:true}); });
const record = (cacheKey: string, payload: string) => ({cacheKey,payload,createdAt:new Date().toISOString(),expiresAt});
describe("indexed pending Sense queue", () => {
  it("tracks job lifecycle without matching status text inside saved payloads", async () => {
    await db.saveTechLaunchReadinessCache({...record(key, JSON.stringify({status:"running",history:"x".repeat(100000)})),senseJobStatus:"running"});
    await db.saveTechLaunchReadinessCache(record("sense:v1:"+"b".repeat(64), '{"status":"running"}'));
    expect(await db.listPendingSenseJobs()).toEqual([key]);
    await db.saveTechLaunchReadinessCache({...record(key,'{"status":"completed","nested":{"status":"running"}}'),senseJobStatus:"completed"});
    expect(await db.listPendingSenseJobs()).toEqual([]);
  });
  it("excludes paused and expired jobs, then resumes an unpaused job", async () => {
    await db.saveTechLaunchReadinessCache({...record(key,'{}'),senseJobStatus:"running"});
    await db.saveTechLaunchReadinessCache(record(key+":paused",'true'));
    expect(await db.listPendingSenseJobs()).toEqual([]);
    await db.saveTechLaunchReadinessCache(record(key+":paused",'false'));
    expect(await db.listPendingSenseJobs()).toEqual([key]);
    await db.saveTechLaunchReadinessCache({...record(key,'{}'),expiresAt:"2000-01-01T00:00:00Z",senseJobStatus:"running"});
    expect(await db.listPendingSenseJobs()).toEqual([]);
  });
  it("uses the primary-key index for queue discovery", async () => {
    await db.saveTechLaunchReadinessCache(record("other","{}"));
    const plan = execFileSync("sqlite3",[join(root,"data/analytics.sqlite"),"EXPLAIN QUERY PLAN SELECT cache_key FROM tech_launch_readiness_cache WHERE cache_key >= 'sense:pending:' AND cache_key < 'sense:pending;';"],{encoding:"utf8"});
    expect(plan).toContain("USING COVERING INDEX");
  });
});
