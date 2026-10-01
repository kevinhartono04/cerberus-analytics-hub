import { beforeEach, describe, expect, it, vi } from "vitest";
const { records, leases } = vi.hoisted(() => ({records:new Map<string,string>(),leases:new Map<string,string>()}));
vi.mock("@/lib/db", () => ({
  getTechLaunchReadinessCache: vi.fn(async(key:string)=>leases.has(key)?{payload:leases.get(key)}:records.has(key)?{payload:records.get(key)}:null),
  saveTechLaunchReadinessCache: vi.fn(async(r:{cacheKey:string;payload:string})=>{records.set(r.cacheKey,r.payload);}),
  claimSenseLease: vi.fn(async(key:string,token:string)=>{if(leases.has(key))return false;leases.set(key,token);return true;}),
  listPendingSenseJobs:vi.fn(async()=>[]),
  releaseSenseLease: vi.fn(async(key:string,token:string)=>{if(leases.get(key)===token)leases.delete(key);}),
}));
vi.mock("@/lib/sensortower-api",()=>({sensorTowerRequest:async(url:URL)=>{const response=await fetch(url);return {status:response.status,body:await response.text()};}}));
import { advanceSense, startSense, getSenseStatus, setSensePaused, runSenseWorker, getSenseGame } from "@/lib/ludios-sense";
import { shiftDate } from "@/lib/ludios-sense-detection";
const t="2026-09-28";
beforeEach(()=>{records.clear();leases.clear();process.env.SENSOR_TOWER_TOKEN="test-private-token";vi.unstubAllGlobals();});
describe("resumable Sense scan",()=>{
  it("persists pause controls and polls compact summaries without making upstream requests",async()=>{
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const run=await startSense({date:t,countries:["US"]});
    expect((await getSenseStatus(run.jobKey)).requests).toBe(0);
    expect((await setSensePaused(run.jobKey,true)).paused).toBe(true);
    await runSenseWorker(run.jobKey,60000);
    expect(fetch).not.toHaveBeenCalled();
    expect((await setSensePaused(run.jobKey,false)).paused).toBe(false);
  });
  it("does not start a second background worker for the same scan",async()=>{
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const run=await startSense({date:t,countries:["US"]});
    leases.set("sense:worker:"+run.jobKey,"another-worker");
    await runSenseWorker(run.jobKey,60000);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not let a stale lease owner overwrite a newer checkpoint",async()=>{
    const run=await startSense({date:t,countries:["US"]});
    vi.stubGlobal("fetch",vi.fn(async()=>{leases.set(run.jobKey+":lease","new-owner");return Response.json({data:[{app_id:"a",est_mobile_downloads:2000}],meta:{total_count:1}});}));
    await advanceSense(run.jobKey);
    const saved=JSON.parse(records.get(run.jobKey)!);
    expect(saved.stores.android.apps).toEqual({});
    expect(saved.requests).toBe(1);
  });
  it("uses combined rankings, normalizes both stores, deduplicates concurrent scans, caches completed scans and refreshes seven days",async()=>{
    const calls:URL[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:URL)=>{
      const url=new URL(input);calls.push(url);let data:unknown;
      if(url.pathname==="/v1/facets/metrics") data={data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1},entities:{app_id:{"123":{name:"Test game"}}}};
      else if(url.pathname.endsWith("/apps")) data={apps:[{app_id:"123",name:"Test game",publisher_name:"Studio",categories:url.pathname.includes("ios")?["7012"]:["GAME_PUZZLE"],release_date:"2026-07-31"}]};
      else {
        const start=url.searchParams.get("start_date")!,end=url.searchParams.get("end_date")!;
        const rows=[];
        for(let d=start;d<=end;d=shiftDate(d,1)) for(const c of ["JP","US"]) {const v=d>=shiftDate(t,-2)?600:200;rows.push(url.pathname.includes("ios")?{aid:"123",cc:c,d,iu:v,au:0}:{aid:"123",c,d,u:v});}
        data=rows;
      }
      return new Response(JSON.stringify(data));
    }));
    const filters={date:t,countries:["JP","US"] as ("JP"|"US")[]};
    let run=await startSense(filters);
    expect((await startSense(filters)).jobKey).toBe(run.jobKey);
    expect(calls).toHaveLength(0);
    for(let i=0;i<40&&run.status==="running";i++) run=await advanceSense(run.jobKey);
    expect(run.status).toBe("completed");
    expect(run.result?.games).toHaveLength(2);
    expect(run.result?.games.map(g=>g.evaluation.signal)).toEqual(["confirmed_momentum","confirmed_momentum"]);
    expect(run.result?.games[0].evaluation.latest).toBe(1200);
    expect(run.result?.games[0].history).toEqual([]);
    const detail = await getSenseGame(run.jobKey,"123","ios");
    expect(detail.history).toHaveLength(28);
    expect(detail.history.at(-1)?.downloads).toBe(1200);
    expect(run.requests).toBe(calls.length);
    expect(calls.filter(c=>c.pathname==="/v1/facets/metrics")).toHaveLength(6);
    expect(calls.filter(c=>c.pathname==="/v1/facets/metrics").every(c=>c.searchParams.get("regions")==="JP,US")).toBe(true);
    expect(calls.filter(c=>c.pathname.endsWith("sales_report_estimates")).every(c=>c.searchParams.get("countries")==="JP,US")).toBe(true);
    expect(JSON.stringify([...records.values()])).not.toContain("test-private-token");
    expect((await startSense(filters)).cached).toBe(true);
    expect(calls).toHaveLength(run.requests);
    const saved=JSON.parse(records.get(run.jobKey)!); saved.updatedAt="2020-01-01T00:00:00Z";records.set(run.jobKey,JSON.stringify(saved));calls.length=0;
    run=await startSense(filters);
    for(let i=0;i<40&&run.status==="running";i++) run=await advanceSense(run.jobKey);
    expect(run.status).toBe("completed");
    expect(calls.filter(c=>c.pathname.endsWith("sales_report_estimates"))).toHaveLength(2);
    expect(calls.filter(c=>c.pathname.endsWith("/apps"))).toHaveLength(0);
  });
  it("uses completed dates when today is requested and handles API errors without exposing credentials",async()=>{
    const today=new Date().toISOString().slice(0,10);
    vi.stubGlobal("fetch",vi.fn(async(input:URL)=>{expect(new URL(input).searchParams.get("start_date")).toBe(shiftDate(today,-1));return new Response("secret",{status:403});}));
    const run=await startSense({date:today,countries:["US"]});
    const next=await advanceSense(run.jobKey);
    expect(next.status).toBe("error");expect(next.error).toContain("access");expect(JSON.stringify(next)).not.toContain("test-private-token");
  });
  it("does not call Sensor Tower when another worker owns the upstream lease",async()=>{
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const run=await startSense({date:t,countries:["US"]});leases.set("sense:upstream:lease","other");
    expect((await advanceSense(run.jobKey)).status).toBe("running");expect(fetch).not.toHaveBeenCalled();
  });
});
