// @vitest-environment node
import {expect,it} from "vitest";
import {queueFixture} from "./helpers/sense-queue-postgres";
it("only selects live guarded queue jobs and never changes checkpoints or stopped jobs",async()=>{
 const f=await queueFixture();
 try{
  const run=(await f.engine().start({date:"2026-11-16",countries:["US"]}))!;
  const before=await f.store.get(run.jobKey);
  const cases=[{paused:true},{safety_reason:"budget"},{status:"completed"},{status:"error"},{expired:true},{legacy:true},{ledgerStop:true},{source:true}];
  for(const [index,c] of cases.entries()){
   const key="sense:v1:"+(index+1).toString().repeat(64);
   const state={...before!.state,status:c.status ?? "running",...(c.source?{source:{jobKey:run.jobKey,generatedAt:"2026-11-16T00:00:00Z"}}:{})};
   if(c.legacy)delete state.discoveryVersion;
   await f.pg.query(`INSERT INTO cerebral.sense_queue_jobs(job_key,report_date,countries,rule_version,state,paused,safety_reason,expires_at)
    VALUES($1,'2026-11-16',ARRAY['US'],'1.4-aggregate',$2::jsonb,$3,$4,$5)`,[key,JSON.stringify(state),Boolean(c.paused),c.safety_reason ?? null,c.expired?'2000-01-01':'2099-01-01']);
   if(c.ledgerStop)await f.pg.query("INSERT INTO cerebral.sense_transfer_budgets(scope,stop_reason) VALUES($1,'Stopped')",['job:'+key]);
  }
  expect(await f.store.pendingContinuations()).toEqual([{key:run.jobKey,savedOnly:false},{key:"sense:v1:"+"8".repeat(64),savedOnly:true}]);
  expect(await f.store.get(run.jobKey)).toEqual(before);expect(f.calls).toHaveLength(0);
 }finally{await f.pg.close();}
});
