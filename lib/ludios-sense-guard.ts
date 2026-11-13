import type {QueueDatabase} from "./ludios-sense-queue-store";
import {QUEUE_RUN_LIMIT} from "./ludios-sense-queue-types";
export const SENSE_DAY_LIMIT=300*1024*1024;
// Stop a step after 4 MiB. A bounded response can add up to 4 MiB before that
// check fires; reserve 9 MiB up front including a margin for control reads.
export const SENSE_STEP_LIMIT=4*1024*1024;
export const SENSE_STEP_RESERVATION=9*1024*1024;
const RESERVED_MS=90000,MAX_PROCESSING_MS=2*60*60*1000;
export class SenseTransferGuard {
 constructor(readonly db:QueueDatabase){}
 async reserve(key:string,token:string):Promise<{reserved:boolean;reason?:string}>{
  return this.db.transaction(async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('sense:transfer-budget',0))",[],{safetyControl:true});
   const [current]=await db.query("SELECT read_bytes,paused,state->>'status' AS status FROM cerebral.sense_queue_jobs WHERE job_key=$1 AND expires_at>now()",[key],{safetyControl:true});
   if(!current || current.paused || current.status!=="running")return {reserved:false};
   const [clock]=await db.query("SELECT 'day:' || (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS day",[],{safetyControl:true});
   const day=String(clock.day),scope="job:"+key;
   await db.query("INSERT INTO cerebral.sense_transfer_budgets(scope,charged_bytes,measured_bytes) VALUES($1,$2,$2),($3,0,0) ON CONFLICT(scope) DO NOTHING",[scope,Number(current.read_bytes),day]);
   const rows=await db.query("SELECT scope,charged_bytes,processing_ms,stalled_steps,stop_reason FROM cerebral.sense_transfer_budgets WHERE scope IN ($1,$2) ORDER BY scope FOR UPDATE",[scope,day],{safetyControl:true});
   for(const row of rows){
    const limit=row.scope===day?SENSE_DAY_LIMIT:QUEUE_RUN_LIMIT;
    const reason=row.stop_reason ? String(row.stop_reason) : Number(row.charged_bytes)+SENSE_STEP_RESERVATION>limit ?
     `Sense transfer budget reached (${row.scope===day?"all checks today, WIB":"this check"}); paused for review.` :
     row.scope===scope && (Number(row.processing_ms)>=MAX_PROCESSING_MS||Number(row.stalled_steps)>=3) ? "Sense safety stop: repeated steps without progress or excessive processing time." : undefined;
    if(reason){await db.query("UPDATE cerebral.sense_transfer_budgets SET stop_reason=$2,updated_at=now() WHERE scope=$1",[row.scope,reason]);return {reserved:false,reason};}
   }
   await db.query("UPDATE cerebral.sense_transfer_budgets SET charged_bytes=charged_bytes+$3,processing_ms=processing_ms+$4,updated_at=now() WHERE scope IN ($1,$2)",[scope,day,SENSE_STEP_RESERVATION,RESERVED_MS]);
   await db.query("INSERT INTO cerebral.sense_transfer_reservations(token,job_key,day_scope,reserved_bytes) VALUES($1,$2,$3,$4)",[token,key,day,SENSE_STEP_RESERVATION]);
   return {reserved:true};
  });
 }
 async settle(token:string,bytes:number,elapsedMs:number,progressed:boolean|null){
  return this.db.transaction(async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('sense:transfer-budget',0))",[],{safetyControl:true});
   const [r]=await db.query("SELECT job_key,day_scope,reserved_bytes FROM cerebral.sense_transfer_reservations WHERE token=$1 AND settled_at IS NULL FOR UPDATE",[token],{safetyControl:true});
   if(!r)return;
   // Control-query overhead is not billing-grade. A killed worker never settles,
   // so its entire reservation stays charged; it cannot disappear on retry.
   const measured=Math.max(0,Math.ceil(bytes));
   const charged=progressed===false?Math.max(measured,Number(r.reserved_bytes)):measured;
   const elapsed=Math.max(progressed===false?RESERVED_MS:0,Math.ceil(elapsedMs));
   await db.query(`UPDATE cerebral.sense_transfer_budgets SET charged_bytes=charged_bytes-$3+$8,
    measured_bytes=measured_bytes+$4,processing_ms=processing_ms-$5+$6,
    stalled_steps=CASE WHEN scope=$1 AND $7::boolean IS NOT NULL THEN CASE WHEN $7 THEN 0 ELSE stalled_steps+1 END ELSE stalled_steps END,updated_at=now()
    WHERE scope IN ($1,$2)`,["job:"+r.job_key,r.day_scope,Number(r.reserved_bytes),measured,RESERVED_MS,elapsed,progressed,charged]);
   await db.query("UPDATE cerebral.sense_transfer_reservations SET measured_bytes=$2,elapsed_ms=$3,settled_at=now() WHERE token=$1",[token,measured,elapsed]);
  });
 }
}
