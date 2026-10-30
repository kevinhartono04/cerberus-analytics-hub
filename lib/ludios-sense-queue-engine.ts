import {createHash,randomUUID} from "node:crypto";
import {aggregateSenseHistory,classifySense,evaluateSense,senseRuleVersion,shiftDate,validDownloads} from "./ludios-sense-detection";
import {historyWindows,mergeCountryHistory,mergeHistoryWindows,requiredHistoryWeeks} from "./ludios-sense-history";
import {safeSenseIconUrl} from "./ludios-sense-icons";
import {measureSenseTransfer,senseReadBytes} from "./ludios-sense-transfer";
import {SenseQueueStore,queueProgress} from "./ludios-sense-queue-store";
import {QUEUE_DISCOVERY_LIMIT,QUEUE_RUN_LIMIT,queueKey} from "./ludios-sense-queue-types";
import type {QueueApp,QueueCandidate,QueueChange,QueueJob,QueueState,SharedChange,StoreCursor} from "./ludios-sense-queue-types";
import type {SenseCountry,SenseFilters,SenseGame,SenseStore} from "./ludios-sense-types";

export interface QueueServices {
  readCache<T>(key:string,maxBytes?:number,projection?:"ranking"):Promise<T|null>;
  writeCache(key:string,value:unknown,days?:number):Promise<void>;
  hydrate(app:QueueApp):Promise<void>;
  persist(app:QueueApp):Promise<void>;
  chart(key:string,generatedAt:string,game:SenseGame):Promise<void>;
  request(endpoint:string,parameters:Record<string,string|number>):Promise<unknown>;
  reserve():Promise<void>;
  upstream<T>(work:()=>Promise<T>):Promise<T>;
  now():string;
}
const stores:SenseStore[]=["android","ios"];
const jsonClone=<T>(value:T):T=>structuredClone(value);
const change=(candidate:QueueCandidate):QueueChange=>({appId:candidate.appId,store:candidate.store,app:candidate.app,stage:candidate.stage,weeks:candidate.weeks,weekIndex:candidate.weekIndex});
const label=(store:SenseStore)=>store==="android"?"Android":"iOS";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function cursor(date:string):StoreCursor{return {phase:"discovery",rankingDate:date,offset:0,datesFound:0,daysChecked:0,lastDownloads:Number.MAX_SAFE_INTEGER,candidates:0,metadata:0,history:0,reports:0};}

export class SenseQueueEngine {
  constructor(readonly store:SenseQueueStore,readonly services:QueueServices){}
  async start(filters:SenseFilters,deriveOnly=false){
    const key=queueKey(filters),existing=await this.store.get(key);
    if(existing)return {...await this.progress(existing.key),cached:existing.state.status==="completed"};
    const source=await this.store.subsetSource(filters,senseRuleVersion);
    if(deriveOnly&&!source)return null;
    const today=this.services.now().slice(0,10),latest=filters.date<today?filters.date:shiftDate(today,-1);
    const state:QueueState={engine:1,filters,status:"running",progress:"Discovering Android games across the selected countries…",store:"android",stores:{android:cursor(latest),ios:cursor(latest)},retry:0};
    if(source?.state.result){
      const result=source.state.result;
      state.source={jobKey:source.key,generatedAt:result.generatedAt};
      state.result={...result,filters,generatedAt:this.services.now(),reusedFrom:result.reusedFrom ?? {jobKey:source.key,countries:source.state.filters.countries,generatedAt:result.generatedAt}};
      for(const store of stores){state.stores[store].phase="finalize";state.stores[store].watermark=result.watermarks[store];}
      state.progress="Recalculating saved country observations…";
    }
    return {...queueProgress(await this.store.create(key,state,source?.key)),cached:Boolean(source)};
  }
  async cached(filters:SenseFilters){return this.start(filters,true);}
  async progress(key:string){
    const job=await this.store.get(key);if(!job)throw Response.json({error:"Scan not found"},{status:404});
    const externalPause=await this.services.readCache<boolean>(key+":paused",1024);
    return {...queueProgress(job),paused:job.paused||Boolean(externalPause)};
  }
  async request(job:QueueJob,endpoint:string,parameters:Record<string,string|number>){
    const slot="sense:queue-response:v1:"+hash([job.key,endpoint,parameters]);
    const ranking=endpoint==="/v1/facets/metrics"?"sense:ranking:"+hash(parameters):null;
    type Cached={retrievedAt:string;payload:unknown};
    const existing=await this.services.readCache<Cached>(slot,undefined,ranking?"ranking":undefined);
    if(existing)return existing.payload;
    if(ranking){const saved=await this.services.readCache<Cached>(ranking,undefined,"ranking");if(saved && Date.parse(this.services.now())-Date.parse(saved.retrievedAt)<7*86400000)return saved.payload;}
    if(job.state.source)throw new Error("Saved-data worker cannot perform an upstream scan");
    return this.services.upstream(async()=>{
      const cached=await this.services.readCache<Cached>(slot,undefined,ranking?"ranking":undefined);if(cached)return cached.payload;
      await this.services.reserve();
      job.requests=await this.store.recordAttempt(job,randomUUID(),endpoint,parameters);
      const payload=await this.services.request(endpoint,parameters),saved={retrievedAt:this.services.now(),payload};
      await this.services.writeCache(slot,saved,31);
      if(ranking && Array.isArray((payload as {data?:unknown[]})?.data) && (payload as {data:unknown[]}).data.length)await this.services.writeCache(ranking,saved,7);
      return payload;
    });
  }
  async advance(key:string,savedOnly=false){
    return measureSenseTransfer("queue_step",async()=>{
      const readStart=senseReadBytes(),token=randomUUID();
      try{
        const externalPause=await this.services.readCache<boolean>(key+":paused",1024);
        if(externalPause)return queueProgress(await this.store.pause(key,true));
        const current=await this.store.claim(key,token);
        if(!current)return this.progress(key);
        if(current.readBytes>=QUEUE_RUN_LIMIT || current.discoveryReadBytes>=QUEUE_DISCOVERY_LIMIT)
          return queueProgress(await this.store.pause(key,true,"Scan paused at its database transfer budget. Review before resuming."));
        if(savedOnly&&!current.state.source)throw new Error("Saved-data worker cannot perform an upstream scan");
        if(current.state.retryAt && current.state.retryAt>this.services.now())return queueProgress(current);
        const next=jsonClone(current.state),changes:QueueChange[]=[],shared:SharedChange[]=[];
        let ranking:{appId:string;name:string;date:string}[]|undefined;
        try{
          const state=next.stores[next.store];
          if(state.phase==="discovery")ranking=await this.discovery(current,next);
          else if(state.phase==="metadata"){const batch=await this.metadata(current,next);changes.push(...batch.changes);shared.push(...batch.shared);}
          else if(state.phase==="history")changes.push(...await this.history(current,next));
          else if(state.phase==="finalize"){
            const batch=await this.finalize(current,next);changes.push(...batch.changes);shared.push(...batch.shared);
          }
          next.retry=0;delete next.retryAt;if(next.result?.coverageComplete!==false)delete next.error;
        }catch(error){
          const message=error instanceof Error?error.message:"Scan processing failed";
          if(message.includes("transfer budget"))throw error;
          if(message.includes("lease or was paused")||message.includes("Shared app changed"))return this.progress(key);
          if(message.includes("active request")||message.includes("is busy"))return queueProgress(current);
          if(message.includes("allowance")||message.includes("request budget")){
            next.error=message;next.result={filters:next.filters,generatedAt:this.services.now(),watermarks:Object.fromEntries(stores.flatMap(s=>next.stores[s].watermark?[[s,next.stores[s].watermark]]:[])),errors:[message],coverageComplete:false,ruleVersion:senseRuleVersion};
            next.store="android";for(const store of stores)next.stores[store].phase="finalize";
            next.progress="Call allowance reached. Saving fully collected games with partial coverage.";
          }else{
            next.retry++;next.error=message;
            if(next.retry>=3||/Unexpected|unavailable|Invalid|cannot perform/.test(message)){next.status="error";next.progress=message;}
            else{next.retryAt=new Date(Date.parse(this.services.now())+Math.min(60000,10000*2**next.retry)).toISOString();next.progress=`${message}. Retrying shortly (${next.retry}/3)…`;}
          }
        }
        const updated=await this.store.commit(current,next,changes,readStart,{ranking,shared});
        if(updated.state.status==="running" && (updated.readBytes>=QUEUE_RUN_LIMIT||updated.discoveryReadBytes>=QUEUE_DISCOVERY_LIMIT))
          return queueProgress(await this.store.pause(key,true,"Scan paused at its database transfer budget. Review before resuming."));
        console.info("[ludios-sense]",JSON.stringify({event:"queue_step_completed",scan:key.slice(-8),store:next.store,phase:next.stores[next.store].phase,requests:updated.requests,readBytes:updated.readBytes,discoveryReadBytes:updated.discoveryReadBytes,rssBytes:process.memoryUsage().rss,heapBytes:process.memoryUsage().heapUsed}));
        return queueProgress(updated);
      }catch(error){
        if(error instanceof Error&&error.message.includes("transfer budget"))return queueProgress(await this.store.pause(key,true,error.message));
        if(error instanceof Error&&/lease or was paused|Shared app changed/.test(error.message))return this.progress(key);
        throw error;
      }finally{await this.store.release(key,token);}
    });
  }
  private async discovery(job:QueueJob,next:QueueState){
    const store=next.store,s=next.stores[store],date=s.rankingDate;
    const p=await this.request(job,"/v1/facets/metrics",{bundle:"mobile_store_top_apps",order_by:"est_mobile_downloads:desc",breakdown:"app_id",start_date:date,end_date:date,regions:next.filters.countries.join(","),devices:store==="ios"?"iphone,ipad":"android",entities:"app_id:name",limit:200,offset:s.offset}) as {data:{app_id:string|number;est_mobile_downloads:number;name?:string}[];entities?:{app_id?:Record<string,{name?:string}>};meta?:{total_count?:number}};
    if(!Array.isArray(p?.data)||p.data.length>200)throw new Error("Unexpected Sensor Tower ranking response");
    const seen=new Set<string>(),ranking:{appId:string;name:string;date:string}[]=[];
    for(const row of p.data){
      const id=String(row.app_id);
      if(!["string","number"].includes(typeof row.app_id)||!id||id.length>200||!validDownloads(row.est_mobile_downloads)||row.est_mobile_downloads>s.lastDownloads||seen.has(id))throw new Error("Unexpected ranking order or duplicate app");
      seen.add(id);s.lastDownloads=row.est_mobile_downloads;
      if(row.est_mobile_downloads>=1000)ranking.push({appId:id,name:row.name ?? p.entities?.app_id?.[id]?.name ?? id,date});
    }
    if(p.data.length&&!s.watermark)s.watermark=date;
    s.offset+=p.data.length;
    if(!p.data.length||s.lastDownloads<1000||s.offset>=(p.meta?.total_count ?? Infinity)){
      if(s.offset>0)s.datesFound++;s.daysChecked++;s.offset=0;s.lastDownloads=Number.MAX_SAFE_INTEGER;s.rankingDate=shiftDate(date,-1);
      if(s.datesFound>=3||s.daysChecked>=7){if(!s.watermark||s.datesFound<3)throw new Error(`Discovery incomplete for ${store}: three reporting days are not available`);s.phase="metadata";}
    }
    next.progress=`${label(store)} discovery: ${s.datesFound}/3 reporting dates checked; ranking offset ${s.offset}.`;
    return ranking;
  }
  private async metadata(job:QueueJob,next:QueueState){
    const store=next.store,s=next.stores[store],batch=await this.store.batch(job.key,store,"metadata");
    if(!batch.length){s.phase="history";next.progress=`${label(store)}: collecting missing download history…`;return {changes:[],shared:[]};}
    const stale=batch.filter(c=>!c.app.metadataAt||Date.parse(this.services.now())-Date.parse(c.app.metadataAt)>=30*86400000);
    if(stale.length){
      const p=await this.request(job,`/v1/${store}/apps`,{app_ids:stale.map(c=>c.appId).join(","),country:next.filters.countries.includes("US")?"US":next.filters.countries[0]}) as {apps:Record<string,unknown>[]};
      if(!Array.isArray(p?.apps))throw new Error("Unexpected Sensor Tower app details response");
      const seen=new Set<string>();
      for(const raw of p.apps){
        const candidate=stale.find(c=>c.appId===String(raw.app_id));
        if(!candidate||seen.has(candidate.appId))throw new Error("Unexpected app in metadata response");seen.add(candidate.appId);
        Object.assign(candidate.app,{name:String(raw.name ?? candidate.app.name),publisher:String(raw.publisher_name ?? ""),iconUrl:safeSenseIconUrl(raw.icon_url),unifiedAppId:typeof raw.unified_app_id==="string"&&raw.unified_app_id.trim()?raw.unified_app_id.trim():null,categories:Array.isArray(raw.categories)?raw.categories.map(String):[],releaseDate:typeof raw.release_date==="string"?raw.release_date.slice(0,10):null});
      }
      for(const candidate of stale)candidate.app.metadataAt=this.services.now();
    }
    const changes:QueueChange[]=[];
    for(const c of batch){
      const excluded=classifySense(c.appId,store,c.app.categories).classification==="excluded";
      const weeks=excluded?[]:requiredHistoryWeeks(c.app,next.filters.countries,s.watermark!,s.watermark!>=shiftDate(this.services.now().slice(0,10),-7));
      if(c.app.historyRef||Object.keys(c.app.histories).length)await this.services.persist(c.app);
      changes.push({...change(c),stage:excluded?"excluded":"history",weeks,weekIndex:0});
    }
    s.metadata+=batch.length;next.progress=`${label(store)}: app details ready (${s.metadata}/${s.candidates}).`;
    // Remember newly fetched excluded metadata too; otherwise non-games are fetched again every day.
    const excluded=batch.filter(c=>stale.includes(c)&&classifySense(c.appId,store,c.app.categories).classification==="excluded");
    const shared=await this.store.shared(excluded);
    for(const saved of shared){
      const incoming=excluded.find(c=>c.appId===saved.appId)!.app;
      if(saved.version===null){saved.app=jsonClone(incoming);continue;}
      if((incoming.metadataAt ?? "")>(saved.app.metadataAt ?? "")){
        const {name,publisher,categories,releaseDate,metadataAt,iconUrl,unifiedAppId}=incoming;
        saved.app={...saved.app,name,publisher,categories,releaseDate,metadataAt,iconUrl,unifiedAppId};
      }
      saved.app.discoveredDate=saved.app.discoveredDate>incoming.discoveredDate?saved.app.discoveredDate:incoming.discoveredDate;
    }
    return {changes,shared};
  }
  private async history(job:QueueJob,next:QueueState){
    const store=next.store,s=next.stores[store],batch=await this.store.batch(job.key,store,"history");
    if(!batch.length){s.phase="finalize";this.beginResult(next);return [];}
    const weeks=batch[0].weeks,index=batch[0].weekIndex;
    if(weeks.length){
      const end=shiftDate(s.watermark!,-weeks[index]*7),start=shiftDate(end,-6);
      const p=await this.request(job,`/v1/${store}/sales_report_estimates`,{app_ids:batch.map(c=>c.appId).join(","),countries:next.filters.countries.join(","),date_granularity:"daily",start_date:start,end_date:end});
      if(!Array.isArray(p))throw new Error("Unexpected Sensor Tower history response");
      const normalized=new Map<string,number|null>();
      for(const raw of p){
        const country=raw[store==="ios"?"cc":"c"] as SenseCountry,id=String(raw.aid),date=typeof raw.d==="string"?raw.d.slice(0,10):"";
        if(!batch.some(c=>c.appId===id)||!next.filters.countries.includes(country)||date<start||date>end)throw new Error("Unexpected app, country or date in history response");
        const parts=store==="ios"?[raw.iu,raw.au]:[raw.u],value=parts.every(validDownloads)?parts.reduce((a:number,b:number)=>a+b,0):null,key=`${id}:${country}:${date}`;
        if(normalized.has(key)&&normalized.get(key)!==value)throw new Error("Conflicting duplicate download observation");normalized.set(key,value);
      }
      for(const c of batch){
        await this.services.hydrate(c.app);
        for(const country of next.filters.countries){
          c.app.histories[country] ??= {};
          for(let i=0;i<7;i++){const d=shiftDate(start,i),value=normalized.get(`${c.appId}:${country}:${d}`);if(validDownloads(value))c.app.histories[country]![d]=value;else delete c.app.histories[country]![d];}
          c.app.historyWindows ??= {};c.app.historyWindows[country]=mergeHistoryWindows([...historyWindows(c.app,country),{start,end,at:this.services.now()}]);
        }
        c.app.historyAt=this.services.now();
        if(index+1>=weeks.length){c.app.backfilled=true;c.app.historyStart=shiftDate(s.watermark!,-27);c.app.historyEnd=s.watermark;}
        await this.services.persist(c.app);
      }
    }
    const done=!weeks.length||index+1>=weeks.length;if(done)s.history+=batch.length;
    next.progress=`${label(store)}: ${s.history} game histories ready.`;
    return batch.map(c=>({...change(c),stage:done?"finalize":"history",weekIndex:weeks.length?index+1:0}));
  }
  private beginResult(next:QueueState){
    next.result ??= {filters:next.filters,generatedAt:this.services.now(),watermarks:{},errors:[],coverageComplete:true,ruleVersion:senseRuleVersion};
    for(const store of stores)if(next.stores[store].watermark)next.result.watermarks[store]=next.stores[store].watermark;
  }
  private async finalize(job:QueueJob,next:QueueState){
    this.beginResult(next);
    const store=next.store,s=next.stores[store],batch=await this.store.batch(job.key,store,"finalize");
    const changes:QueueChange[]=[],shared:SharedChange[]=[];
    if(!batch.length){
      s.phase="done";
      if(store==="android"){next.store="ios";next.progress=next.source?"Recalculating saved iOS observations…":"Discovering iOS games across the selected countries…";}
      else{next.status="completed";next.progress=next.result!.coverageComplete?"Check complete. Downloads are combined across the selected countries, separately for each store.":"Call allowance reached. Partial report saved; some games or stores were not checked.";}
      return {changes,shared};
    }
    const currentShared=next.source?[]:await this.store.shared(batch);
    for(const c of batch){
      const app=c.app,t=s.watermark!;
      if(next.source&&requiredHistoryWeeks(app,next.filters.countries,t,false).length)throw new Error("Saved country coverage is unavailable");
      await this.services.hydrate(app);
      const aggregate=aggregateSenseHistory(app.histories,next.filters.countries,t),evaluation=evaluateSense(aggregate.history,t,app.releaseDate);
      if(store==="android")evaluation.flags.push("latest_android_provisional");
      if(aggregate.unavailableCountries.length)evaluation.flags.push("some_countries_unavailable");
      const country=next.filters.countries.includes("US")?"US":next.filters.countries[0];
      const game:SenseGame={appId:c.appId,store,name:app.name,publisher:app.publisher,iconUrl:app.iconUrl,unifiedAppId:app.unifiedAppId,releaseDate:app.releaseDate,...classifySense(c.appId,store,app.categories),...aggregate,evaluation,retrievedAt:app.historyAt ?? this.services.now(),url:store==="ios"?`https://apps.apple.com/${country.toLowerCase()}/app/id${c.appId}`:`https://play.google.com/store/apps/details?id=${encodeURIComponent(c.appId)}&gl=${country}`};
      await this.services.chart(job.key,next.result!.generatedAt,game);
      game.history=[];game.historyLoaded=false;
      await this.services.persist(app);
      changes.push({...change(c),stage:"reported",result:game});
      const previous=currentShared.find(a=>a.store===store&&a.appId===c.appId);
      if(previous){shared.push({...previous,app:previous.version===null?jsonClone(app):await this.merge(previous.app,app)});}
    }
    s.reports+=batch.length;next.progress=`Saving game reports (${next.stores.android.reports+next.stores.ios.reports} complete)…`;
    return {changes,shared};
  }
  private async merge(previous:QueueApp,incoming:QueueApp){
    const left=jsonClone(previous),right=jsonClone(incoming);
    await this.services.hydrate(left);await this.services.hydrate(right);
    const histories:QueueApp["histories"]={},windows:NonNullable<QueueApp["historyWindows"]>={};
    for(const country of new Set([...Object.keys(left.histories),...Object.keys(right.histories),...Object.keys(left.historyWindows ?? {}),...Object.keys(right.historyWindows ?? {})]) as Set<SenseCountry>){
      const merged=mergeCountryHistory(left,right,country);histories[country]=merged.histories;windows[country]=merged.windows;
    }
    const metadata=(right.metadataAt ?? "")>(left.metadataAt ?? "")?right:left;
    const merged:QueueApp={...metadata,discoveredDate:left.discoveredDate>right.discoveredDate?left.discoveredDate:right.discoveredDate,historyAt:(left.historyAt ?? "")>(right.historyAt ?? "")?left.historyAt:right.historyAt,histories,historyWindows:windows,historyRef:undefined,historyRefExpiresAt:undefined};
    delete merged.countryHistory;await this.services.persist(merged);return merged;
  }
}
