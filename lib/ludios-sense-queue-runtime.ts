import {randomUUID} from "node:crypto";
import {claimSenseLease,getTechLaunchReadinessCache,releaseSenseLease,senseQueueDatabase,saveTechLaunchReadinessCache} from "./db";
import {SenseQueueStore} from "./ludios-sense-queue-store";
import {SenseQueueEngine} from "./ludios-sense-queue-engine";
import {boundedSenseJson,hydrateSenseHistory,persistSenseHistory,persistSenseChart,readSenseDocument,senseChartKey} from "./ludios-sense-storage";
import {recordSenseOrganizationUsage,reserveSenseRequest} from "./ludios-sense-usage";
import {sensorTowerRequest} from "./sensortower-api";

let runtime:SenseQueueEngine|undefined;
export function senseQueueRuntime(){
  return runtime ??= new SenseQueueEngine(new SenseQueueStore(senseQueueDatabase()),{
    async readCache<T>(key:string,maxBytes=4*1024*1024,projection?:"ranking"):Promise<T|null>{
      if(projection!=="ranking")return readSenseDocument<T>(key,maxBytes);
      const row=await getTechLaunchReadinessCache(key,maxBytes,{senseRanking:true});
      return row && row.expiresAt>new Date().toISOString()?JSON.parse(row.payload) as T:null;
    },
    async writeCache(cacheKey,value,days=31){await saveTechLaunchReadinessCache({cacheKey,payload:boundedSenseJson(value),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+days*86400000).toISOString()});},
    hydrate:hydrateSenseHistory,persist:persistSenseHistory,
    async chart(key,generatedAt,game){await persistSenseChart(senseChartKey(key,generatedAt,game.store,game.appId),game);},
    async reserve(){if(!process.env.SENSOR_TOWER_TOKEN?.trim())throw new Error("Sensor Tower is not configured on this server");await reserveSenseRequest();},
    async request(endpoint,parameters){
      const token=process.env.SENSOR_TOWER_TOKEN?.trim();
      if(!token)throw new Error("Sensor Tower is not configured on this server");
      const url=new URL(endpoint,"https://api.sensortower.com");
      Object.entries(parameters).forEach(([key,value])=>url.searchParams.set(key,String(value)));url.searchParams.set("auth_token",token);
      const started=Date.now(),response=await sensorTowerRequest(url);
      console.info("[ludios-sense]",JSON.stringify({event:"queue_sensor_response",endpoint,status:response.status,elapsedMs:Date.now()-started,responseBytes:Buffer.byteLength(response.body),apps:String(parameters.app_ids ?? "").split(",").filter(Boolean).length}));
      await recordSenseOrganizationUsage(response.usageHeaders);
      if(response.status<200||response.status>=300)throw new Error(response.status===401||response.status===403?"Sensor Tower token or product access is unavailable":`Sensor Tower request failed (${response.status})`);
      return JSON.parse(response.body.replaceAll(token,"[REDACTED]"));
    },
    async upstream(work){
      const token=randomUUID();
      if(!await claimSenseLease("sense:upstream:lease",token,new Date(Date.now()+90000).toISOString()))throw new Error("Waiting for the active request");
      try{return await work();}finally{await releaseSenseLease("sense:upstream:lease",token,1000);}
    },
    now:()=>new Date().toISOString(),
  });
}


export async function requireSenseQueueBootstrap(){
  const marker=await readSenseDocument<{status?:string;version?:number}>("sense:queue-bootstrap:v1",4096);
  if(marker?.status!=="ready" || marker.version!==1)throw Response.json({error:"Queue storage must be prepared before a scan can start"},{status:409});
}
