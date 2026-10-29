// @vitest-environment node
import {PGlite} from "@electric-sql/pglite";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("postgres",()=>({default:()=>async(strings:TemplateStringsArray,...values:unknown[])=>mock.query(strings.reduce((sql,part,index)=>sql+part+(index<values.length?`$${index+1}`:""),""),values)}));
import {getTechLaunchReadinessCache} from "@/lib/db";
const pg=new PGlite();
beforeAll(()=>{vi.stubEnv("CEREBRAL_DATABASE_URL","postgres://fixture@localhost/test");mock.query.mockImplementation(async(sql:string,values:unknown[])=>(await pg.query(sql,values)).rows);});
afterAll(async()=>{vi.unstubAllEnvs();await pg.close();});
it("executes the actual ranking projection in Postgres and keeps only ordered discovery fields",async()=>{
 await getTechLaunchReadinessCache("missing");
 const payload={retrievedAt:"2026-10-29T08:00:00Z",payload:{meta:{total_count:2},data:[{app_id:"b",est_mobile_downloads:2000,extra:"x".repeat(10000)},{app_id:123,est_mobile_downloads:1000}],entities:{app_id:{b:{name:"First"},"123":{name:"Second"}}}}};
 await pg.query("INSERT INTO tech_launch_readiness_cache VALUES($1,$2,$3,$4)",["ranking",JSON.stringify(payload),"2026-10-29T08:00:00Z","2099-01-01"]);
 const record=await getTechLaunchReadinessCache("ranking",30000,{senseRanking:true});
 expect(JSON.parse(record!.payload)).toEqual({retrievedAt:payload.retrievedAt,payload:{meta:{total_count:2},data:[{app_id:"b",est_mobile_downloads:2000,name:"First"},{app_id:123,est_mobile_downloads:1000,name:"Second"}]}});
 expect(record!.payload.length).toBeLessThan(400);
 await expect(getTechLaunchReadinessCache("ranking",100,{senseRanking:true})).rejects.toThrow("safe storage limit");
});
