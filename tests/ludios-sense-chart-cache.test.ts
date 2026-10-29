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

it("projects progress inside SQLite before returning a legacy inline report",async()=>{
 const key="sense:v1:"+"e".repeat(64);
 const result={generatedAt:"2026-10-27T03:00:00.000Z",games:Array.from({length:2000},(_,i)=>({appId:String(i),name:"x".repeat(900)})),filters:{countries:["US"]}};
 await db.saveTechLaunchReadinessCache({cacheKey:key+":summary",payload:JSON.stringify({jobKey:key,status:"completed",requests:1,progress:"Done",result}),createdAt:new Date().toISOString(),expiresAt:"2099-01-01T00:00:00Z"});
 const row=await db.getTechLaunchReadinessCache(key+":summary",4*1024*1024,{senseProgress:true});
 expect(Buffer.byteLength(row!.payload)).toBeLessThan(1024);
 const progress=JSON.parse(row!.payload);
 expect(progress.reportPageCount).toBe(1);expect(progress.result.generatedAt).toBe(result.generatedAt);
 expect(progress.result.games).toBeUndefined();
});
