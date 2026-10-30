// @vitest-environment node
import postgres from "postgres";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {PGliteWire} from "./helpers/pglite-wire";
import {queueFixture,type QueueFixture} from "./helpers/sense-queue-postgres";
import {SenseQueueStore} from "@/lib/ludios-sense-queue-store";
import {SenseQueueEngine} from "@/lib/ludios-sense-queue-engine";
const mock=vi.hoisted(()=>({client:null as unknown}));
vi.mock("postgres",async importOriginal=>{const actual=await importOriginal<typeof import("postgres")>();return {...actual,default:(...args:unknown[])=>args.length===1?actual.default(args[0] as never):mock.client};});
import {senseQueueDatabase} from "@/lib/db";
let f:QueueFixture,client:ReturnType<typeof postgres>;
beforeAll(async()=>{
 f=await queueFixture();await f.pg.exec("SET search_path TO cerebral,public");
 const options={max:1,prepare:false,fetch_types:true,socket:()=>new PGliteWire(f.pg)};
 client=postgres(options);mock.client=client;vi.stubEnv("CEREBRAL_DATABASE_URL","postgres://fixture@localhost/test");
});
afterAll(async()=>{await client.end({timeout:1});await f.pg.close();vi.unstubAllEnvs();});
it("round-trips queue JSON and arrays through the real production driver and commits a scan",async()=>{
 const store=new SenseQueueStore(senseQueueDatabase()),engine=new SenseQueueEngine(store,f.services);
 let run=(await engine.start({date:"2026-09-28",countries:["JP","US"]}))!;
 expect((await store.get(run.jobKey))!.state.stores.android.candidates).toBe(0);
 for(let step=0;step<100&&run.status==="running";step++)run=await engine.advance(run.jobKey);
 expect(run.status).toBe("completed");expect((await store.report(run.jobKey,0)).result.games).toHaveLength(2);
},30000);
