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
  it("commits checkpoint, summary and queue only while the lease is still owned", async () => {
    await db.claimSenseLease(key+":lease","current",expiresAt);
    await db.saveTechLaunchReadinessCache({...record(key,'{"step":1}'),senseJobStatus:"running",senseSummaryPayload:'{"step":1}',expectedSenseLease:"current"});
    await expect(db.saveTechLaunchReadinessCache({...record(key,'{"step":2}'),senseJobStatus:"completed",senseSummaryPayload:'{"step":2}',expectedSenseLease:"stale"})).rejects.toThrow();
    expect((await db.getTechLaunchReadinessCache(key))?.payload).toBe('{"step":1}');
    expect((await db.getTechLaunchReadinessCache(key+":summary"))?.payload).toBe('{"step":1}');
    expect(await db.listPendingSenseJobs()).toEqual([key]);
    await db.releaseSenseLease(key+":lease","current");
    await expect(db.saveTechLaunchReadinessCache({...record(key,'{}'),senseJobStatus:"completed",expectedSenseLease:"current"})).rejects.toThrow();
    expect(await db.listPendingSenseJobs()).toEqual([key]);
  });
  it("rejects oversized UTF-8 records before returning their payload", async () => {
    await db.saveTechLaunchReadinessCache(record(key, 'é'.repeat(20)));
    await expect(db.getTechLaunchReadinessCache(key, 30)).rejects.toThrow("offline migration");
    expect((await db.getTechLaunchReadinessCache(key, 40))?.payload).toBe('é'.repeat(20));
  });
});

it("keeps exact queue prefixes and boundary IDs inside the indexed range",async()=>{
  const keys=["0","f"].map(c=>"sense:v1:"+c.repeat(64));
  for(const k of keys)await db.saveTechLaunchReadinessCache({...record(k,'{}'),senseJobStatus:"running"});
  for(const prefix of ["sense:pending-other:","sense:pendingx:","sense:pending;","sense:pendinh:"])
    await db.saveTechLaunchReadinessCache(record(prefix+key,''));
  expect((await db.listPendingSenseJobs()).sort()).toEqual(keys);
});
