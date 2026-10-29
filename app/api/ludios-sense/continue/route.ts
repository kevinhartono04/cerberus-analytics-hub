import {after} from "next/server";
import {z,ZodError} from "zod";
import {assertInternalAppUser,jsonError,requireCurrentAppUser} from "@/lib/auth";
import {getSenseProgress,runSenseWorker} from "@/lib/ludios-sense";
import {queueEnabled} from "@/lib/ludios-sense-queue-types";
import {senseQueueRuntime} from "@/lib/ludios-sense-queue-runtime";
import {measureSenseTransfer} from "@/lib/ludios-sense-transfer";
export const runtime="nodejs";
export const maxDuration=300;
export const preferredRegion="iad1";
/** Explicit continuation of a manually started queue job; progress polling remains read-only. */
export async function POST(request:Request){
 return measureSenseTransfer("continue",async()=>{
  try{
   assertInternalAppUser(await requireCurrentAppUser(request));
   const {jobKey}=z.object({jobKey:z.string().regex(/^sense:v1:[a-f0-9]{64}$/)}).parse(await request.json());
   if(!queueEnabled())throw Response.json({error:"Queue engine is not enabled"},{status:409});
   const job=await senseQueueRuntime().store.get(jobKey);
   if(!job)throw Response.json({error:"Legacy scan cannot be continued by this worker"},{status:409});
   const progress=await getSenseProgress(jobKey);
   if(progress.paused||progress.status!=="running")return Response.json({accepted:false,scan:progress});
   if(!progress.workerActive)after(()=>runSenseWorker(jobKey,240000,Boolean(job.state.source)));
   return Response.json({accepted:true,scan:{...progress,workerActive:true}});
  }catch(error){
   if(error instanceof ZodError)return Response.json({error:"Invalid scan ID"},{status:400});
   return jsonError(error);
  }
 });
}
