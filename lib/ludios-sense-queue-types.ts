import {createHash} from "node:crypto";
import type {SenseFilters,SenseGame,SenseResult,SenseRunResponse,SenseStore} from "./ludios-sense-types";
import type {ShardedHistory} from "./ludios-sense-storage";
import {senseRuleVersion} from "./ludios-sense-detection";

export type QueueApp = ShardedHistory & {
  appId:string; name:string; publisher:string; categories:string[]; releaseDate:string|null;
  discoveredDate:string; metadataAt?:string; iconUrl?:string|null; unifiedAppId?:string|null;
};
export type QueuePhase="discovery"|"metadata"|"history"|"finalize"|"done";
export type StoreCursor={phase:QueuePhase;rankingDate:string;watermark?:string;offset:number;datesFound:number;daysChecked:number;lastDownloads:number;candidates:number;metadata:number;history:number;reports:number};
export type QueueState={engine:1;filters:SenseFilters;status:SenseRunResponse["status"];progress:string;store:SenseStore;stores:Record<SenseStore,StoreCursor>;retry:number;retryAt?:string;error?:string;result?:Omit<SenseResult,"games"|"requests">;source?:{jobKey:string;generatedAt:string};legacyReadBytes?:number};
export type QueueJob={key:string;state:QueueState;revision:number;requests:number;readBytes:number;discoveryReadBytes:number;paused:boolean;safetyReason:string|null;updatedAt:string;expiresAt:string;token?:string};
export type QueueCandidate={appId:string;store:SenseStore;app:QueueApp;weeks:number[];weekIndex:number;stage:string};
export type QueueChange={appId:string;store:SenseStore;app:QueueApp;stage:string;weeks:number[];weekIndex:number;result?:SenseGame};
export type SharedChange={store:SenseStore;appId:string;app:QueueApp;version:number|null};
export const QUEUE_PAGE_SIZE=100;
export const QUEUE_DISCOVERY_LIMIT=25*1024*1024;
export const QUEUE_RUN_LIMIT=250*1024*1024;
export const queueKey=(filters:SenseFilters)=>"sense:v1:"+createHash("sha256").update(JSON.stringify({engine:1,ruleVersion:senseRuleVersion,date:filters.date,countries:[...filters.countries].sort()})).digest("hex");
export const queueEnabled=()=>process.env.SENSE_QUEUE_ENGINE==="true";
