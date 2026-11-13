// @vitest-environment node
import {expect,it} from "vitest";
import {queueFixture} from "./helpers/sense-queue-postgres";

it("reads only indexed signal rows, preserves pagination and pins report revisions",async()=>{
 const f=await queueFixture();
 try {
  const run=(await f.engine().start({date:"2026-11-13",countries:["US"]}))!;
  const generatedAt="2026-11-13T01:00:00.000Z";
  await f.pg.query(`UPDATE cerebral.sense_queue_jobs SET state=jsonb_set(jsonb_set(state,'{stores,android,reports}','6200'),'{result}',$2::jsonb) WHERE job_key=$1`,[run.jobKey,JSON.stringify({generatedAt})]);
  await f.pg.query(`INSERT INTO cerebral.sense_queue_candidates(job_key,store,app_id,discovered_date,payload,result,sort_rank)
    SELECT $1,'android',i::text,'2026-11-11','{}'::jsonb,jsonb_build_object('appId',i::text,'padding',repeat('x',900)),CASE WHEN i<=205 THEN i%3 ELSE 3 END
    FROM generate_series(1,6200) i`,[run.jobKey]);
  const revision=(await f.store.get(run.jobKey))!.updatedAt;
  const pages=await Promise.all([0,1,2].map(page=>f.store.report(run.jobKey,page,revision,generatedAt,"shortlist")));
  expect(pages.map(p=>p.result.games.length)).toEqual([100,100,5]);
  expect(pages.every(p=>p.pageCount===3 && p.totalRecords===6200 && p.scope==="shortlist")).toBe(true);
  expect(new Set(pages.flatMap(p=>p.result.games.map(g=>g.appId))).size).toBe(205);
  expect(pages.flatMap(p=>p.result.games).every(g=>Number(g.appId)<=205)).toBe(true);
  expect(JSON.stringify(pages).length).toBeLessThan(220000);
  expect((await f.store.report(run.jobKey,0,revision,generatedAt)).pageCount).toBe(62);
  await expect(f.store.report(run.jobKey,3,revision,generatedAt,"shortlist")).rejects.toMatchObject({status:404});
  await expect(f.store.report(run.jobKey,0,"2000-01-01",generatedAt,"shortlist")).rejects.toMatchObject({status:409});
  await expect(f.store.report(run.jobKey,0,revision,"2000-01-01","shortlist")).rejects.toMatchObject({status:409});
  await f.pg.query('UPDATE cerebral.sense_queue_candidates SET sort_rank=3 WHERE job_key=$1',[run.jobKey]);
  expect(await f.store.report(run.jobKey,0,revision,generatedAt,"shortlist")).toMatchObject({pageCount:1,totalRecords:6200,result:{games:[]}});
  expect(f.calls).toHaveLength(0);
 }finally{await f.pg.close();}
});
