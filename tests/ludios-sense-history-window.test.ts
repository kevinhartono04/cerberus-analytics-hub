// @vitest-environment node
import {PGlite} from "@electric-sql/pglite";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {selectSenseHistoryWindow} from "@/lib/ludios-sense-history-window";
import {shiftDate} from "@/lib/ludios-sense-detection";
const mock=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("postgres",()=>({default:()=>Object.assign(async(strings:TemplateStringsArray,...values:unknown[])=>mock.query(strings.reduce((sql,part,index)=>sql+part+(index<values.length?`$${index+1}`:""),""),values),{unsafe:(sql:string,values:unknown[])=>mock.query(sql,values)})}));
import {getTechLaunchReadinessCache} from "@/lib/db";
import {readSenseHistoryWindow} from "@/lib/ludios-sense-storage";
const pg=new PGlite(),end="2026-11-12",start=shiftDate(end,-27);
beforeAll(async()=>{vi.stubEnv("CEREBRAL_DATABASE_URL","postgres://fixture@localhost/test");mock.query.mockImplementation(async(sql:string,values:unknown[])=>(await pg.query(sql,values)).rows);await getTechLaunchReadinessCache("missing");});
afterAll(async()=>{vi.unstubAllEnvs();await pg.close();});
it("projects the exact window in Postgres, preserving revisions, nulls, zero and missing dates",async()=>{
 const histories={US:{[shiftDate(start,-1)]:99,[start]:0,[shiftDate(start,1)]:null,[end]:300,[shiftDate(end,1)]:999},JP:{[end]:88}};
 const historyWindows={US:[{start:shiftDate(start,-90),end,at:"2026-11-12T00:00:00Z"},{start:end,end,at:"2026-11-13T00:00:00Z"}],JP:[{start,end,at:"older"}]};
 const payload={format:4,histories,historyWindows},app={histories:{},historyRef:"window",historyRefExpiresAt:"2099-01-01",historyWindows};
 await pg.query("INSERT INTO tech_launch_readiness_cache VALUES($1,$2,$3,$4)",["window",JSON.stringify(payload),"2026-01-01","2099-01-01"]);
 const selected=await readSenseHistoryWindow(app,["US"],end);
 expect(selected).toEqual(selectSenseHistoryWindow(payload,["US"],end));
 expect(selected.histories.US).toEqual({[start]:0,[shiftDate(start,1)]:null,[end]:300});
 expect(app.historyRef).toBe("window");expect(app.histories).toEqual({});
 const record=await getTechLaunchReadinessCache("window",10000,{senseHistory:{countries:["US"],start,end}});
 expect(JSON.parse(record!.payload).histories.JP).toBeUndefined();
 await expect(getTechLaunchReadinessCache("window",5,{senseHistory:{countries:["US"],start,end}})).rejects.toThrow("safe storage limit");
});
it("reads legacy plain-country blobs and clips legacy coverage without dropping missing observations",async()=>{
 await pg.query("INSERT INTO tech_launch_readiness_cache VALUES($1,$2,$3,$4)",["legacy",JSON.stringify({US:{[end]:10},JP:{[end]:9}}),"2026-01-01","2099-01-01"]);
 const app={histories:{},historyRef:"legacy",backfilled:true,historyStart:shiftDate(start,-30),historyEnd:end,historyAt:"old"};
 const selected=await readSenseHistoryWindow(app,["US"],end);
 expect(selected.historyWindows?.US).toEqual([{start,end,at:"old"}]);expect(selected.histories).toEqual({US:{[end]:10}});
});
it("rejects absent and expired history rather than inventing an empty report",async()=>{
 await expect(readSenseHistoryWindow({histories:{},historyRef:"absent"},["US"],end)).rejects.toThrow("unavailable");
 await pg.query("INSERT INTO tech_launch_readiness_cache VALUES($1,$2,$3,$4)",["expired",JSON.stringify({US:{[end]:10}}),"2000-01-01","2000-01-02"]);
 await expect(readSenseHistoryWindow({histories:{},historyRef:"expired"},["US"],end)).rejects.toThrow("unavailable");
});
