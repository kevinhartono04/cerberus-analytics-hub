import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"sense-chart-cache-"));
let db:typeof import("@/lib/db");
beforeAll(async()=>{
 fs.mkdirSync(path.join(directory,"data"));
 execFileSync("sqlite3",[path.join(directory,"data/analytics.sqlite"),"PRAGMA user_version=1;"]);
 vi.spyOn(process,"cwd").mockReturnValue(directory);
 for(const name of ["CEREBRAL_DATABASE_URL","DATABASE_URL","POSTGRES_URL","POSTGRES_PRISMA_URL","POSTGRES_URL_NON_POOLING"])vi.stubEnv(name,"");
 db=await import("@/lib/db");
});
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();fs.rmSync(directory,{recursive:true,force:true});});
describe("saved game chart projection",()=>{
 it("prioritizes the original snapshot and returns only the selected store's chart",async()=>{
  const game={appId:"1",store:"ios",history:[{date:"2026-09-30",downloads:12}]};
  const save=async(key:string,generatedAt:string,games:unknown[])=>db.saveTechLaunchReadinessCache({cacheKey:key,payload:JSON.stringify({result:{generatedAt,games},stores:{largeCheckpoint:"not returned"}}),createdAt:new Date().toISOString(),expiresAt:"2099-01-01T00:00:00Z"});
  await save("job","new",[{...game,history:[]}]);
  await save("snapshot","original",[game,{...game,store:"android"},{...game,appId:"2"}]);
  const projected=await db.getSenseGameReport(["snapshot","job"],"1","ios");
  expect(JSON.parse(projected!.payload)).toEqual({result:{generatedAt:"original",games:[game]}});
  const fallback=await db.getSenseGameReport(["missing","job"],"1","ios");
  expect(JSON.parse(fallback!.payload).result.generatedAt).toBe("new");
  expect(JSON.parse((await db.getSenseGameReport(["snapshot","job"],"unknown","ios"))!.payload).result.games).toEqual([]);
 });
});
