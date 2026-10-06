import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { senseCountryCodes, type SenseCountry } from "@/lib/ludios-sense-types";
import { aggregateSenseHistory, evaluateSense, shiftDate } from "@/lib/ludios-sense-detection";
const { records,leases,upstream }=vi.hoisted(()=>({records:new Map<string,string>(),leases:new Map<string,string>(),upstream:vi.fn()}));
vi.mock("@/lib/db",()=>({
 getSenseGameReport:vi.fn(async(keys:string[],appId:string,store:string)=>{
  const key=keys.find(key=>records.has(key));if(!key)return null;
  const report=JSON.parse(records.get(key)!);
  return {payload:JSON.stringify({result:{...report.result,games:report.result?.games.filter((g:{appId:string;store:string})=>g.appId===appId&&g.store===store)}})};
 }),
 getTechLaunchReadinessCache:vi.fn(async(key:string)=>leases.has(key)?{payload:leases.get(key)}:records.has(key)?{payload:records.get(key)}:null),
 getSenseDetectionReports:vi.fn(async(keys:string[])=>keys.flatMap(key=>records.has(key)?[{cacheKey:key,payload:records.get(key),expiresAt:"2099-01-01"}]:[])),
 saveTechLaunchReadinessCache:vi.fn(async(record:{cacheKey:string;payload:string})=>records.set(record.cacheKey,record.payload)),
 claimSenseLease:vi.fn(async(key:string,token:string)=>{if(leases.has(key))return false;leases.set(key,token);return true;}),
 releaseSenseLease:vi.fn(async(key:string,token:string)=>{if(leases.get(key)===token)leases.delete(key);}),listPendingSenseJobs:vi.fn(async()=>[]),
}));
vi.mock("@/lib/sensortower-api",()=>({sensorTowerRequest:upstream}));
import { advanceSense, estimateSense, getCachedSense, getSenseGame, getSenseWatchlist, startSense } from "@/lib/ludios-sense";
const date="2026-09-28",generatedAt="2026-09-29T03:00:00Z";
const key=(countries:SenseCountry[],day=date)=>"sense:v1:"+createHash("sha256").update(JSON.stringify({date:day,countries:[...new Set(countries)].sort()})).digest("hex");
function source(countries:SenseCountry[]=senseCountryCodes,complete=true) {
 const filters={date,countries:[...countries].sort()},jobKey=key(countries);
 const stores=Object.fromEntries(["android","ios"].map(store=>{
  const histories=Object.fromEntries(countries.map(country=>[country,Object.fromEntries(Array.from({length:28},(_,index)=>{const day=shiftDate(date,index-27);return [day,country==="JP" ? (index>=25?3000:300) : 100];}))]));
  const app={appId:"123",name:"Game",publisher:"Studio",categories:store==="ios"?["7012"]:["GAME_PUZZLE"],releaseDate:null,iconUrl:null,unifiedAppId:null,metadataAt:generatedAt,discoveredDate:date,histories,historyWindows:Object.fromEntries(countries.map(country=>[country,[{start:shiftDate(date,-27),end:date,at:generatedAt}]])),historyAt:generatedAt};
  return [store,{apps:{"123":app},ids:["123"],historyIds:["123"],historyIndex:1,phase:"done",watermark:date}];
 }));
 const games=Object.entries(stores).map(([store,state])=>{
  const aggregate=aggregateSenseHistory(state.apps["123"].histories,countries,date);
  return {appId:"123",store,name:"Game",publisher:"Studio",genre:"Puzzle",classification:"included",releaseDate:null,iconUrl:null,unifiedAppId:null,url:"https://example.com",...aggregate,evaluation:evaluateSense(aggregate.history,date,null),retrievedAt:generatedAt};
 });
 const result={filters,games,generatedAt,watermarks:{android:date,ios:date},requests:14,errors:complete?[]:["Call allowance reached; coverage incomplete."],coverageComplete:complete,ruleVersion:"1.4-aggregate"};
 const job={jobKey,filters,status:"completed",createdAt:generatedAt,updatedAt:generatedAt,requests:14,progress:"Complete",stores,store:"ios",result,retry:0,receipts:[]};
 records.set(jobKey,JSON.stringify(job));records.set(jobKey+":summary",JSON.stringify({jobKey,status:"completed",requests:14,progress:"Complete",result:{...result,games:games.map(game=>({...game,history:[]}))}}));
 return job;
}
beforeEach(()=>{records.clear();leases.clear();upstream.mockReset();process.env.SENSOR_TOWER_TOKEN="test-only";delete process.env.SENSE_MONTHLY_REQUEST_LIMIT;});
describe("saved country subsets",()=>{
 it("deselects Japan using saved per-country data, changes the signals and charts, and makes no upstream calls",async()=>{
  const original=source(),before=records.get(original.jobKey);
  expect(original.result.games[0].evaluation.signal).toBe("confirmed_momentum");
  const countries=senseCountryCodes.filter(country=>country!=="JP");
  const cached=await getCachedSense({date,countries});
  expect(cached?.status).toBe("completed");expect(cached?.cached).toBe(true);expect(cached?.requests).toBe(0);
  expect(cached?.result?.filters.countries).toEqual(countries);expect(cached?.result?.reusedFrom?.jobKey).toBe(original.jobKey);
  expect(cached?.result?.games.every(game=>game.evaluation.latest===600 && game.evaluation.signal==="none")).toBe(true);
  const detail=await getSenseGame(cached!.jobKey,"123","ios",cached!.result!.generatedAt);
  expect(detail.history).toHaveLength(28);expect(detail.history.every(point=>point.downloads===600)).toBe(true);
  expect(records.get(original.jobKey)).toBe(before);
  const run=await startSense({date,countries});expect(run.cached).toBe(true);expect(run.requests).toBe(0);
  const plan=await estimateSense({date,countries});expect(plan.cachedReport).toBe(true);expect(plan.knownHistoryCalls+plan.knownMetadataCalls).toBe(0);
  expect(upstream).not.toHaveBeenCalled();
 });
 it("handles Run check directly before the cache lookup, even when upstream credentials are unavailable",async()=>{
  source();delete process.env.SENSOR_TOWER_TOKEN;
  const run=await startSense({date,countries:["US"]});expect(run.status).toBe("completed");expect(run.cached).toBe(true);expect(upstream).not.toHaveBeenCalled();
 });
 it("preserves partial coverage instead of silently treating a partial source as complete",async()=>{
  source(senseCountryCodes,false);
  const run=await getCachedSense({date,countries:["US"]});expect(run?.result?.coverageComplete).toBe(false);expect(run?.result?.errors).toEqual(["Call allowance reached; coverage incomplete."]);expect(upstream).not.toHaveBeenCalled();
 });
 it("can use another saved superset when the seven-country report is unavailable",async()=>{
  const original=source(["JP","US"]);
  const run=await getCachedSense({date,countries:["US"]});expect(run?.result?.reusedFrom?.jobKey).toBe(original.jobKey);expect(upstream).not.toHaveBeenCalled();
 });
 it("preserves the original data retrieval time through successive saved subsets",async()=>{
  const original=source();
  await getCachedSense({date,countries:["JP","US"]});
  records.delete(original.jobKey);records.delete(original.jobKey+":summary");
  const run=await getCachedSense({date,countries:["US"]});
  expect(run?.result?.reusedFrom).toEqual({jobKey:original.jobKey,countries:original.filters.countries,generatedAt});
  expect(upstream).not.toHaveBeenCalled();
 });
 it("does not reuse another date, add an unqueried country, or invent missing coverage",async()=>{
  const original=source(["JP","US"]);
  expect(await getCachedSense({date:shiftDate(date,-1),countries:["US"]})).toBeNull();
  expect(await getCachedSense({date,countries:["US","DE"]})).toBeNull();
  delete original.stores.ios.apps["123"].historyWindows.US;
  records.set(original.jobKey,JSON.stringify(original));
  expect(await getCachedSense({date,countries:["US"]})).toBeNull();expect(upstream).not.toHaveBeenCalled();
 });
 it("treats queried missing observations as gaps and unavailable countries, never as zeros",async()=>{
  const original=source();for(const store of Object.values(original.stores))delete store.apps["123"].histories.US[date];
  records.set(original.jobKey,JSON.stringify(original));
  const run=await getCachedSense({date,countries:["US"]});const detail=await getSenseGame(run!.jobKey,"123","ios",run!.result!.generatedAt);
  expect(detail.history.at(-1)?.downloads).toBeNull();expect(upstream).not.toHaveBeenCalled();
 });
 it("stops a pre-fix narrower run before its next request and preserves calls already attempted",async()=>{
  source();const filters={date,countries:["US"] as SenseCountry[]},jobKey=key(filters.countries);
  const existing={jobKey,filters,status:"running",createdAt:generatedAt,updatedAt:generatedAt,requests:3,progress:"Discovery",stores:{android:{apps:{}},ios:{apps:{}}},store:"android",retry:0,receipts:[{endpoint:"/v1/facets/metrics",parameters:{regions:"US"},retrievedAt:generatedAt}]};
  records.set(jobKey,JSON.stringify(existing));records.set(jobKey+":summary",JSON.stringify({...existing,stores:undefined,requests:4}));
  const run=await advanceSense(jobKey);expect(run.status).toBe("completed");expect(run.cached).toBe(true);expect(run.requests).toBe(4);expect(JSON.parse(records.get(jobKey)!).receipts).toHaveLength(1);expect(upstream).not.toHaveBeenCalled();
 });
 it("respects the target job's lease and leaves a running worker's checkpoint alone",async()=>{
  source();const jobKey=key(["US"]);leases.set(jobKey+":lease","worker");
  expect(await getCachedSense({date,countries:["US"]})).toBeNull();expect(records.has(jobKey)).toBe(false);expect(upstream).not.toHaveBeenCalled();
 });
 it("loads previous saved detections through the compact batch reader",async()=>{
  const original=source();
  const prior=structuredClone(original),priorDate=shiftDate(date,-1);
  prior.jobKey=key(original.filters.countries,priorDate);prior.filters.date=priorDate;prior.result.filters.date=priorDate;
  for(const game of prior.result.games)game.evaluation.date=priorDate;
  records.set(prior.jobKey+":summary",JSON.stringify(prior));
  for(const game of original.result.games){game.evaluation.signal="none";game.evaluation.latest=86722;game.evaluation.recentAverage=90133;}
  records.set(original.jobKey+":summary",JSON.stringify(original));
  const watch=await getSenseWatchlist(original.jobKey);
  expect(watch).toHaveLength(2);expect(watch.every(game=>game.watch?.status==="holding_scale")).toBe(true);
  expect(watch[0].watch?.lastDetected).toBe(priorDate);expect(upstream).not.toHaveBeenCalled();
 });
 it("does not reconstruct seven-day subset detections from a different basket's saved signals",async()=>{
  source();const run=await getCachedSense({date,countries:["US"]});expect(await getSenseWatchlist(run!.jobKey)).toEqual([]);expect(upstream).not.toHaveBeenCalled();
 });
});
