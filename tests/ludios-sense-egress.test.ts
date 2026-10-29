// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const {records,reads,leases} = vi.hoisted(()=>({leases:new Map<string,string>(),records:new Map<string,{payload:string;expiresAt:string}>(),reads:[] as string[]}));
vi.mock("@/lib/db",()=>({
  getTechLaunchReadinessCache:vi.fn(async(key:string,_max:number,options?:{senseProgress?:boolean})=>{
    reads.push(key);const row=leases.has(key)?{payload:leases.get(key)!,expiresAt:"2099-01-01"}:records.get(key);if(!row)return null;
    let payload=row.payload;
    if(options?.senseProgress){
      const doc=JSON.parse(payload);delete doc.stores;delete doc.receipts;
      doc.reportPageCount=doc.result?Math.max(1,doc.result.gamePages?.length??0):0;
      if(doc.result){delete doc.result.games;delete doc.result.gamePages;}
      payload=JSON.stringify(doc);
    }
    countSenseRead(payload);return {...row,payload};
  }),
  saveTechLaunchReadinessCache:vi.fn(async(row:{cacheKey:string;payload:string;expiresAt:string;senseSummaryPayload?:string})=>{
    records.set(row.cacheKey,row);if(row.senseSummaryPayload)records.set(row.cacheKey+":summary",{payload:row.senseSummaryPayload,expiresAt:row.expiresAt});
  }),
  claimSenseLease:vi.fn(async(key:string,token:string)=>{if(leases.has(key))return false;leases.set(key,token);return true;}),
  releaseSenseLease:vi.fn(async(key:string)=>{leases.delete(key);}),
}));
import {countSenseRead,measureSenseTransfer} from "@/lib/ludios-sense-transfer";
import {prepareSenseManifest,readSenseRecord} from "@/lib/ludios-sense-storage";
import {getCachedSense,advanceSense,getSenseProgress,getSenseReportPage,estimateSense} from "@/lib/ludios-sense";
const key="sense:v1:"+"a".repeat(64);
const expiresAt="2099-01-01";
const put=(key:string,value:unknown)=>records.set(key,{payload:JSON.stringify(value),expiresAt});
beforeEach(()=>{records.clear();reads.length=0;leases.clear();});

it("polls a multi-megabyte saved report without reading any result pages",async()=>{
  const games=Array.from({length:6000},(_,i)=>({appId:String(i),name:"x".repeat(900)}));
  const result={games,generatedAt:"2026-10-27T09:21:16.228Z",filters:{date:"2026-10-27",countries:["US"]},ruleVersion:"1.4-aggregate"};
  put(key+":summary",await prepareSenseManifest({jobKey:key,status:"completed",progress:"Done",requests:403,result}));
  reads.length=0;
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  try{
    await measureSenseTransfer("status",async()=>{
      for(let i=0;i<100;i++){
        const progress=await getSenseProgress(key);
        expect(progress.result?.games).toEqual([]);expect(progress.reportLoaded).toBe(false);
        expect(Buffer.byteLength(JSON.stringify(progress))).toBeLessThan(2048);
      }
    });
    expect(reads.every(ref=>ref===key+":summary"||ref===key+":paused")).toBe(true);
    const transfer=JSON.parse(String(log.mock.calls.at(-1)![1]));
    expect(transfer.readBytes).toBeLessThan(200*1024);
  }finally{log.mockRestore();}
  reads.length=0;
  const page=await getSenseReportPage(key,result.generatedAt,0);
  expect(page.result.games.length).toBeGreaterThan(0);
  expect(page.result.games.length).toBeLessThan(6000);
  expect(reads.filter(ref=>ref.startsWith("sense:games:"))).toHaveLength(1);
  await expect(getSenseReportPage(key,"2020-01-01T00:00:00Z",0)).rejects.toMatchObject({status:409});
});

it("edits only batch pages and preserves all other games across a restart",async()=>{
  const apps=Object.fromEntries(Array.from({length:6000},(_,i)=>[String(i).padStart(5,"0"),{name:"x".repeat(1000),histories:{}}]));
  put(key,await prepareSenseManifest({stores:{android:{apps},ios:{apps:{}}}}));
  reads.length=0;
  const batch:any=await readSenseRecord(key,4*1024*1024,()=>({android:["00001"],ios:[]}));
  expect(Object.keys(batch.stores.android.apps).length).toBeLessThan(300);
  expect(reads.filter(ref=>ref.startsWith("sense:page:"))).toHaveLength(1);
  batch.stores.android.apps["00001"].name="Updated";
  put(key,await prepareSenseManifest(batch));
  const restarted:any=await readSenseRecord(key);
  expect(Object.keys(restarted.stores.android.apps)).toHaveLength(6000);
  expect(restarted.stores.android.apps).toEqual({...apps,"00001":{...apps["00001"],name:"Updated"}});
});

it("does not load histories, derive subsets, or write records when showing the allowance",async()=>{
  const before=records.size;
  await estimateSense({date:"2026-10-27",countries:["US"]});
  expect(records.size).toBe(before);
  expect(reads.some(ref=>ref.startsWith("sense:history:")||ref.startsWith("sense:page:"))).toBe(false);
});

it("reuses immutable pages only within the invocation and always refreshes mutable roots",async()=>{
  const apps=Object.fromEntries(Array.from({length:600},(_,i)=>[String(i),{name:"x".repeat(1000)}]));
  put(key,await prepareSenseManifest({stores:{android:{apps},ios:{apps:{}}}}));
  reads.length=0;
  await measureSenseTransfer("worker",async()=>{await readSenseRecord(key);await readSenseRecord(key);});
  expect(reads.filter(ref=>ref===key)).toHaveLength(2);
  const pageReads=reads.filter(ref=>ref.startsWith("sense:page:"));
  expect(new Set(pageReads).size).toBe(pageReads.length);
  await readSenseRecord(key);
  expect(reads.filter(ref=>ref.startsWith("sense:page:")).length).toBe(pageReads.length*2);
});


it("finalizes a 6,000-game scan within the transfer budget and publishes shared history once",async()=>{
  const date="2026-10-27",generatedAt="2026-10-27T03:00:00.000Z";
  const ids=Array.from({length:6000},(_,i)=>String(i).padStart(5,"0"));
  const apps=Object.fromEntries(ids.map(id=>[id,{appId:id,name:"Game "+id,publisher:"Studio",categories:["GAME_PUZZLE"],releaseDate:null,discoveredDate:date,histories:{US:{[date]:2000}}}]));
  const state={apps,ids,historyIds:ids,historyIndex:ids.length,watermark:date,phase:"done"};
  const result={filters:{date,countries:["US"]},generatedAt,games:[],watermarks:{android:date},errors:[],requests:0,coverageComplete:true,ruleVersion:"1.4-aggregate"};
  put(key,await prepareSenseManifest({jobKey:key,filters:result.filters,status:"running",requests:0,progress:"Saving",store:"ios",stores:{android:state,ios:{...state,apps:{},ids:[],historyIds:[],historyIndex:0}},subsetReuseChecked:true,finalization:{complete:true,android:0,ios:0},result,retry:0,receipts:[]}));
  put(key+":summary",{jobKey:key,status:"running",progress:"Saving",requests:0});
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  try{
    await measureSenseTransfer("synthetic_finalization",async()=>{
      let run=await getSenseProgress(key);
      for(let i=0;i<240 && run.status==="running";i++)run=await advanceSense(key);
      expect(run.status).toBe("completed");expect(run.result?.games).toHaveLength(6000);
      expect(run.result?.games.every(g=>g.evaluation.latest===2000)).toBe(true);
    });
    expect(reads.filter(ref=>ref==="sense:history:shared:v2")).toHaveLength(1);
    const transfer=JSON.parse(String(log.mock.calls.at(-1)![1]));
    expect(transfer.readBytes).toBeLessThan(256*1024*1024);
    console.log("SYNTHETIC_FINALIZATION_BYTES",transfer.readBytes);
  }finally{log.mockRestore();}
},60000);


it("opens an exact saved report through the cache endpoint without expanding its pages",async()=>{
  const filters={date:"2026-10-27",countries:["US"] as const};
  const jobKey="sense:v1:"+createHash("sha256").update(JSON.stringify(filters)).digest("hex");
  const games=Array.from({length:3000},(_,i)=>({appId:String(i),name:"x".repeat(900)}));
  put(jobKey+":summary",await prepareSenseManifest({jobKey,status:"completed",requests:403,progress:"Done",result:{filters,generatedAt:"2026-10-27T03:00:00.000Z",games,ruleVersion:"1.4-aggregate"}}));
  reads.length=0;
  const cached=await getCachedSense({...filters,countries:["US"]});
  expect(cached?.cached).toBe(true);expect(cached?.reportLoaded).toBe(false);
  expect(reads.some(ref=>ref.startsWith("sense:games:")||ref.startsWith("sense:page:"))).toBe(false);
});
