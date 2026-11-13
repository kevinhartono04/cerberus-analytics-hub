import type {QueueDatabase} from "./ludios-sense-queue-store";
import {QUEUE_RUN_LIMIT} from "./ludios-sense-queue-types";
export const SENSE_DAY_LIMIT=300*1024*1024;
// Stop a step after 4 MiB. A bounded response can add up to 4 MiB before that
// check fires; reserve 9 MiB up front including a margin for control reads.
export const SENSE_STEP_LIMIT=4*1024*1024;
export const SENSE_STEP_RESERVATION=9*1024*1024;
const RESERVED_MS=90000,MAX_PROCESSING_MS=2*60*60*1000;
/** Private invoker-privilege functions make each durable operation one round trip. */
export class SenseTransferGuard {
 constructor(readonly db:QueueDatabase){}
 async reserve(key:string,token:string):Promise<{reserved:boolean;reason?:string}>{
  const [row]=await this.db.query("SELECT * FROM cerebral.reserve_sense_transfer($1,$2,$3,$4,$5,$6,$7)",
   [key,token,QUEUE_RUN_LIMIT,SENSE_DAY_LIMIT,SENSE_STEP_RESERVATION,RESERVED_MS,MAX_PROCESSING_MS],{safetyControl:true});
  if(!row)throw new Error("Sense budget reservation unavailable");
  return {reserved:Boolean(row.reserved),...(row.reason?{reason:String(row.reason)}:{})};
 }
 async settle(token:string,bytes:number,elapsedMs:number,progressed:boolean|null){
  await this.db.query("SELECT cerebral.settle_sense_transfer($1,$2,$3,$4,$5)",
   [token,Math.max(0,Math.ceil(bytes)),Math.max(0,Math.ceil(elapsedMs)),progressed,RESERVED_MS],{safetyControl:true});
 }
}
