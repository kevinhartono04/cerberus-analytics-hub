import { beforeEach, describe, expect, it, vi } from "vitest";
const { records, writes } = vi.hoisted(() => ({records:new Map<string,{payload:string;expiresAt:string}>(),writes:vi.fn()}));
vi.mock("@/lib/db",()=>({
  getTechLaunchReadinessCache:vi.fn(async(key:string)=>records.get(key) ?? null),
  saveTechLaunchReadinessCache:async(record:{cacheKey:string;payload:string;expiresAt:string})=>{writes(record);records.set(record.cacheKey,record);},
}));
import { hydrateSenseHistory, persistSenseHistory, persistSenseChart, senseChartKey, readSenseRecord, prepareSenseManifest, type ShardedHistory } from "@/lib/ludios-sense-storage";
import { requiredHistoryWeeks } from "@/lib/ludios-sense-history";
beforeEach(()=>{records.clear();writes.mockClear();});
describe("immutable per-game storage",()=>{
  it("preserves legacy coverage and revised missing observations across process restarts",async()=>{
    const app:ShardedHistory={histories:{US:{"2026-10-20":30}},backfilled:true,historyStart:"2026-09-24",historyEnd:"2026-10-21",historyAt:"2026-10-22T00:00:00Z"};
    await persistSenseHistory(app);
    expect(app.histories).toEqual({});expect(requiredHistoryWeeks(app,["US"],"2026-10-21",false)).toEqual([]);
    const checkpoint=JSON.stringify(app),oldRef=app.historyRef!;
    const restarted:ShardedHistory=JSON.parse(checkpoint);
    await hydrateSenseHistory(restarted);delete restarted.histories.US!["2026-10-20"];
    await persistSenseHistory(restarted);
    expect(restarted.historyRef).not.toBe(oldRef);
    const historical:ShardedHistory=JSON.parse(checkpoint);await hydrateSenseHistory(historical);
    expect(historical.histories.US!["2026-10-20"]).toBe(30);
    await hydrateSenseHistory(restarted);expect(restarted.histories.US!["2026-10-20"]).toBeUndefined();
  });
  it("does not rewrite unchanged histories on each checkpoint",async()=>{
    const app:ShardedHistory={histories:{US:{"2026-10-20":30}}};await persistSenseHistory(app);
    writes.mockClear();await persistSenseHistory(JSON.parse(JSON.stringify(app)));expect(writes).not.toHaveBeenCalled();
    await hydrateSenseHistory(app);await persistSenseHistory(app);expect(writes).not.toHaveBeenCalled();
  });
  it("fails closed on missing shards and oversized records instead of inventing empty data",async()=>{
    await expect(hydrateSenseHistory({histories:{},historyRef:"missing"})).rejects.toThrow("unavailable");
    records.set("large",{payload:'"'+'x'.repeat(32)+'"',expiresAt:"2099-01-01"});
    await expect(readSenseRecord("large",16)).rejects.toThrow("offline migration");
  });
  it("keeps a 100+ MiB collection of observations out of its manifest",async()=>{
    const histories={US:Object.fromEntries(Array.from({length:5000},(_,i)=>[String(i),123456789]))};
    const apps:Record<string,ShardedHistory>={};
    const bytes=Buffer.byteLength(JSON.stringify(histories));
    const count=Math.ceil(105*1024*1024/bytes);
    for(let i=0;i<count;i++){const app:ShardedHistory={histories};await persistSenseHistory(app);apps[String(i)]=app;}
    expect(bytes*count).toBeGreaterThan(100*1024*1024);
    expect(Buffer.byteLength(JSON.stringify(apps))).toBeLessThan(1024*1024);
    expect(Math.max(...[...records.values()].map(r=>Buffer.byteLength(r.payload)))).toBeLessThan(256*1024);
  });
});

it("restores paged report rows in order and rejects a missing page",async()=>{
  const games=Array.from({length:1200},(_,i)=>({appId:String(i),title:"x".repeat(900)}));
  const root:any=await prepareSenseManifest({result:{games}});
  records.set("report",{payload:JSON.stringify(root),expiresAt:"2099-01-01"});
  expect((await readSenseRecord<any>("report")).result.games).toEqual(games);
  records.delete(root.result.gamePages[0]);
  await expect(readSenseRecord("report")).rejects.toThrow("page is unavailable");
});

it("shares identical chart content across timestamps and rejects missing content",async()=>{
  const chart={appId:"a",history:[{date:"2026-10-20",downloads:42}]};
  const first=senseChartKey("job","first","android","a"),second=senseChartKey("job","second","android","a");
  await persistSenseChart(first,chart);await persistSenseChart(second,chart);
  expect(records.size).toBe(3);
  expect(await readSenseRecord(first)).toEqual(chart);expect(await readSenseRecord(second)).toEqual(chart);
  const ref=JSON.parse(records.get(first)!.payload).chartRef;records.delete(ref);
  await expect(readSenseRecord(first)).rejects.toThrow("unavailable");
  records.set(first,{payload:JSON.stringify(chart),expiresAt:"2099-01-01"});
  expect(await readSenseRecord(first)).toEqual(chart);
});
