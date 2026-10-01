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
import { advanceSense, startSense, getSenseStatus, setSensePaused, runSenseWorker, getSenseGame, estimateSense, getCachedSense, startDailySense } from "@/lib/ludios-sense";
import { shiftDate } from "@/lib/ludios-sense-detection";
const t="2026-09-28";
beforeEach(()=>{records.clear();leases.clear();process.env.SENSOR_TOWER_TOKEN="test-private-token";delete process.env.SENSE_MONTHLY_REQUEST_LIMIT;vi.unstubAllGlobals();});
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
    expect(saved.requests).toBe(0);
    expect((await getSenseStatus(run.jobKey)).requests).toBe(1);
  });
  it("recovers the journaled request count after an interrupted checkpoint without rewriting history before the API call",async()=>{
    const run=await startSense({date:t,countries:["US"]});
    const summary=JSON.parse(records.get(run.jobKey+":summary")!); summary.requests=7;
    records.set(run.jobKey+":summary",JSON.stringify(summary));
    vi.stubGlobal("fetch",vi.fn(async()=>{
      expect(JSON.parse(records.get(run.jobKey)!).requests).toBe(0);
      expect(JSON.parse(records.get(run.jobKey+":summary")!).requests).toBe(8);
      return Response.json({data:[{app_id:"a",est_mobile_downloads:2000}],meta:{total_count:1}});
    }));
    expect((await advanceSense(run.jobKey)).requests).toBe(8);
    expect(JSON.parse(records.get(run.jobKey)!).requests).toBe(8);
  });
  it("finishes a legacy partial batch before switching to 100 apps, keeping four weeks per app",async()=>{
    const run=await startSense({date:t,countries:["US"]});
    const job=JSON.parse(records.get(run.jobKey)!);
    const ids=Array.from({length:125},(_,i)=>String(i));
    const state=job.stores.android;
    Object.assign(state,{phase:"history",watermark:t,historyIds:ids,ids,week:1,historyIndex:0});
    state.apps=Object.fromEntries(ids.map(id=>[id,{appId:id,name:id,publisher:"",categories:["GAME_PUZZLE"],releaseDate:null,discoveredDate:t,histories:{US:{[t]:1}}}]));
    records.set(run.jobKey,JSON.stringify(job));
    const batches:number[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:URL)=>{batches.push(new URL(input).searchParams.get("app_ids")!.split(",").length);return Response.json([]);}));
    for(let i=0;i<7;i++) await advanceSense(run.jobKey);
    expect(batches).toEqual([25,25,25,100,100,100,100]);
    const saved=JSON.parse(records.get(run.jobKey)!);
    expect(saved.stores.android.historyIndex).toBe(125);
    expect(saved.stores.android.historyBatchSize).toBe(100);
    expect(Object.values(saved.stores.android.apps).every((a:any)=>a.backfilled)).toBe(true);
  });
  it("uses combined rankings, normalizes both stores, deduplicates concurrent scans, caches completed scans and refreshes seven days",async()=>{
    const calls:URL[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:URL)=>{
      const url=new URL(input);calls.push(url);let data:unknown;
      if(url.pathname==="/v1/facets/metrics") data={data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1},entities:{app_id:{"123":{name:"Test game"}}}};
      else if(url.pathname.endsWith("/apps")) data={apps:[{app_id:"123",name:"Test game",publisher_name:"Studio",icon_url:"https://example.com/game.png",unified_app_id:"unified-test",categories:url.pathname.includes("ios")?["7012"]:["GAME_PUZZLE"],release_date:"2026-07-31"}]};
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
    expect(run.result?.games.every(g=>g.iconUrl==="https://example.com/game.png" && g.unifiedAppId==="unified-test")).toBe(true);
    expect(run.result?.games.map(g=>g.evaluation.signal)).toEqual(["confirmed_momentum","confirmed_momentum"]);
    expect(run.result?.games[0].evaluation.latest).toBe(1200);
    expect(run.result?.games[0].history).toEqual([]);
    const detail = await getSenseGame(run.jobKey,"123","ios",run.result?.generatedAt);
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
    expect(calls).toHaveLength(0);
    expect(run.cached).toBe(true);
  });
  it("reuses two old discovery dates and country-level history when the date or country selection changes",async()=>{
    const calls:URL[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:URL)=>{
      const url=new URL(input);calls.push(url);
      if(url.pathname.endsWith("metrics")) return Response.json({data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}});
      if(url.pathname.endsWith("/apps")) return Response.json({apps:[{app_id:"123",categories:url.pathname.includes("ios")?["7012"]:["GAME_PUZZLE"]}]});
      return Response.json([]);
    }));
    async function scan(date:string,countries:("JP"|"US")[]) {
      let run=await startSense({date,countries});
      for(let i=0;i<40&&run.status==="running";i++)run=await advanceSense(run.jobKey);
      expect(run.status).toBe("completed");return run;
    }
    await scan(t,["JP","US"]);calls.length=0;
    await scan(shiftDate(t,1),["JP","US"]);
    expect(calls.filter(c=>c.pathname.endsWith("metrics"))).toHaveLength(2);
    expect(calls.filter(c=>c.pathname.endsWith("/apps"))).toHaveLength(0);
    expect(calls.filter(c=>c.pathname.endsWith("sales_report_estimates"))).toHaveLength(2);
    calls.length=0;
    await scan(shiftDate(t,1),["US"]);
    expect(calls.filter(c=>c.pathname.endsWith("sales_report_estimates"))).toHaveLength(2);
    expect(calls.filter(c=>c.pathname.endsWith("/apps"))).toHaveLength(0);
    expect((await estimateSense({date:shiftDate(t,1),countries:["JP","US"]})).knownHistoryCalls).toBe(2);
  });
  it("separates 100 warm games from one cold game instead of backfilling the warm group",async()=>{
    const run=await startSense({date:t,countries:["US"]}),job=JSON.parse(records.get(run.jobKey)!);
    const ids=Array.from({length:101},(_,i)=>String(i).padStart(3,"0"));
    Object.assign(job.stores.android,{phase:"metadata",watermark:t,ids});
    job.stores.android.apps=Object.fromEntries(ids.map((id,i)=>[id,{appId:id,name:id,publisher:"",categories:["GAME_PUZZLE"],releaseDate:null,metadataAt:new Date().toISOString(),discoveredDate:t,histories:{US:{}},backfilled:i<100,historyStart:shiftDate(t,-27),historyEnd:t}]));
    records.set(run.jobKey,JSON.stringify(job));
    const batches:number[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:URL)=>{batches.push(new URL(input).searchParams.get("app_ids")!.split(",").length);return Response.json([]);}));
    await advanceSense(run.jobKey); // metadata is fresh; partition warm/cold.
    for(let i=0;i<5;i++) await advanceSense(run.jobKey);
    expect(batches).toEqual([100,1,1,1,1]);
    expect(JSON.parse(records.get(run.jobKey)!).stores.android.historyIndex).toBe(101);
  });
  it("migrates an existing seven-country cache for a narrower selection without new upstream calls",async()=>{
    const countries=["AU","CA","DE","GB","JP","RU","US"] as any;
    const run=await startSense({date:t,countries}),job=JSON.parse(records.get(run.jobKey)!);
    for(const store of ["android","ios"])job.stores[store].apps={"123":{appId:"123",name:"Game",publisher:"Studio",categories:store==="ios"?["7012"]:["GAME_PUZZLE"],releaseDate:null,metadataAt:new Date().toISOString(),discoveredDate:t,histories:Object.fromEntries(countries.map((c:string)=>[c,{}])),backfilled:true,historyStart:shiftDate(t,-27),historyEnd:t}};
    records.set("sense:history:AU,CA,DE,GB,JP,RU,US",JSON.stringify(job.stores));
    const plan=await estimateSense({date:t,countries:["US"]});
    expect(plan.knownGames).toBe(2);expect(plan.knownHistoryCalls).toBe(2);expect(plan.knownMetadataCalls).toBe(0);
  });
  it("does not mistake a partially retrieved newly selected country for complete coverage",async()=>{
    const run=await startSense({date:t,countries:["JP","US"]}),job=JSON.parse(records.get(run.jobKey)!);
    Object.assign(job.stores.android,{phase:"history",watermark:t,historyIds:["123"],historyIndex:0,week:0});
    job.stores.android.apps={"123":{appId:"123",name:"Game",publisher:"Studio",categories:["GAME_PUZZLE"],releaseDate:null,discoveredDate:t,histories:{US:{},JP:{[t]:3}},countryHistory:{US:{start:shiftDate(t,-27),end:t,at:new Date().toISOString()}},backfilled:true,historyStart:shiftDate(t,-27),historyEnd:t}};
    records.set(run.jobKey,JSON.stringify(job));
    const fetch=vi.fn(async()=>Response.json([]));vi.stubGlobal("fetch",fetch);
    for(let i=0;i<4;i++)await advanceSense(run.jobKey);
    expect(fetch).toHaveBeenCalledTimes(4);expect(JSON.parse(records.get(run.jobKey)!).stores.android.historyIndex).toBe(1);
  });
  it("stops at the monthly allowance without another API call and clearly marks partial coverage",async()=>{
    process.env.SENSE_MONTHLY_REQUEST_LIMIT="2";
    const fetch=vi.fn(async()=>Response.json({data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}}));vi.stubGlobal("fetch",fetch);
    const run=await startSense({date:t,countries:["US"]});
    await advanceSense(run.jobKey);await advanceSense(run.jobKey);
    const partial=await advanceSense(run.jobKey);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(partial.status).toBe("completed");
    expect(partial.result?.coverageComplete).toBe(false);
    expect(partial.result?.games).toEqual([]);
    expect(partial.result?.errors.join()).toContain("allowance");
    expect((await estimateSense({date:t,countries:["US"]})).usage.remaining).toBe(0);
  });
  it("uses completed dates when today is requested and handles API errors without exposing credentials",async()=>{
    const today=new Date().toISOString().slice(0,10);
    vi.stubGlobal("fetch",vi.fn(async(input:URL)=>{expect(new URL(input).searchParams.get("start_date")).toBe(shiftDate(today,-1));return new Response("secret",{status:403});}));
    const run=await startSense({date:today,countries:["US"]});
    const next=await advanceSense(run.jobKey);
    expect(next.status).toBe("error");expect(next.error).toContain("access");expect(JSON.stringify(next)).not.toContain("test-private-token");
  });
  it("reconstructs older discovery but retrieves only the uncovered week and preserves newer history",async()=>{
    const calls:URL[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:URL)=>{
      const url=new URL(input);calls.push(url);
      if(url.pathname.endsWith("metrics"))return Response.json({data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}});
      if(url.pathname.endsWith("/apps"))return Response.json({apps:[{app_id:"123",categories:url.pathname.includes("ios")?["7012"]:["GAME_PUZZLE"]}]});
      const rows=[];for(let d=url.searchParams.get("start_date")!;d<=url.searchParams.get("end_date")!;d=shiftDate(d,1))rows.push(url.pathname.includes("ios")?{aid:"123",cc:"US",d,iu:2000,au:0}:{aid:"123",c:"US",d,u:2000});
      return Response.json(rows);
    }));
    async function scan(date:string){let run=await startSense({date,countries:["US"]});for(let i=0;i<40&&run.status==="running";i++)run=await advanceSense(run.jobKey);expect(run.status).toBe("completed");return run;}
    await scan(t);calls.length=0;
    const older=await scan(shiftDate(t,-7));
    const histories=calls.filter(c=>c.pathname.endsWith("sales_report_estimates"));
    expect(histories).toHaveLength(2);expect(histories.every(c=>c.searchParams.get("start_date")==="2026-08-25" && c.searchParams.get("end_date")==="2026-08-31")).toBe(true);
    expect(calls.filter(c=>c.pathname.endsWith("/apps"))).toHaveLength(0);
    const detail=await getSenseGame(older.jobKey,"123","ios",older.result?.generatedAt);
    expect(detail.history).toHaveLength(28);expect(detail.history.at(-1)?.date).toBe("2026-09-21");
    const shared=JSON.parse(records.get("sense:history:shared:v2")!);
    expect(shared.ios.apps["123"].histories.US[t]).toBe(2000);expect(shared.ios.apps["123"].histories.US["2026-08-25"]).toBe(2000);
    calls.length=0;expect((await scan(t)).cached).toBe(true);expect(calls).toHaveLength(0);
  });
  it("shares the daily job and reads cached results without starting work",async()=>{
    const today=new Date().toISOString().slice(0,10),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    expect(await getCachedSense({date:today,countries:["US"]})).toBeNull();expect(fetch).not.toHaveBeenCalled();
    const first=await startDailySense();expect((await startDailySense()).jobKey).toBe(first.jobKey);
    const job=JSON.parse(records.get(first.jobKey)!);job.status="completed";job.updatedAt="2020-01-01T00:00:00Z";job.result={games:[],filters:job.filters,ruleVersion:"1.4-aggregate"};
    records.set(first.jobKey,JSON.stringify(job));records.set(first.jobKey+":summary",JSON.stringify({...first,status:"completed",result:job.result}));
    expect((await startDailySense()).cached).toBe(true);
    expect((await startSense({date:today,countries:["US","JP","CA","RU","DE","AU","GB"]})).cached).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not call Sensor Tower when another worker owns the upstream lease",async()=>{
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const run=await startSense({date:t,countries:["US"]});leases.set("sense:upstream:lease","other");
    expect((await advanceSense(run.jobKey)).status).toBe("running");expect(fetch).not.toHaveBeenCalled();
  });
});
