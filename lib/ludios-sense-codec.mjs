import { createHash } from 'node:crypto';
export const MANIFEST_PAGE_LIMIT=256*1024;
export const MANIFEST_TOTAL_LIMIT=24*1024*1024;
export const digest=value=>createHash('sha256').update(value).digest('hex');
/** Coverage is compact in the index; exact retrieval/revision windows stay with observations. */
export function encodeHistory(app) {
  const windows={...app.historyWindows};
  for(const country of Object.keys(app.histories ?? {})) {
    const legacy=app.countryHistory?.[country] ?? (app.countryHistory===undefined && app.backfilled && app.historyStart && app.historyEnd ? {start:app.historyStart,end:app.historyEnd,at:app.historyAt ?? ''} : null);
    windows[country] ??= legacy ? [legacy] : [];
  }
  const payload=JSON.stringify({format:4,histories:app.histories,historyWindows:windows,...(app.countryHistory ? {countryHistory:app.countryHistory} : {})});
  const coverage={};
  for(const [country,ranges] of Object.entries(windows)) {
    const merged=[];
    for(const range of [...ranges].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end))) {
      const previous=merged.at(-1);
      const nextDay=previous ? new Date(Date.parse(previous.end+'T00:00:00Z')+86400000).toISOString().slice(0,10) : '';
      if(previous && range.start<=nextDay) previous.end=previous.end>range.end ? previous.end : range.end;
      else merged.push({start:range.start,end:range.end,at:''});
    }
    coverage[country]=merged;
  }
  return {payload,coverage};
}
/** Metadata pages are immutable and bounded, with a total decoding ceiling. */
export async function pageSenseManifest(document,emit,expiresAt) {
  if(!document || typeof document!=="object")return document;
  const source=document.stores ?? (document.android?.apps && document.ios?.apps ? document : null);
  if(!source) return document;
  const output={...document},states={};let total=0;
  for(const store of ['android','ios']) {
    const state=source[store];if(!state)continue;
    const old=new Set((state.appPagesExpiresAt ?? '')>new Date(Date.now()+32*86400000).toISOString() ? state.appPages ?? [] : []);
    const refs=[];let page={},bytes=2,reused=false;
    async function flush(){if(!Object.keys(page).length)return;const payload=JSON.stringify(page);total+=Buffer.byteLength(payload);if(total>MANIFEST_TOTAL_LIMIT)throw new Error('Scan metadata exceeds the bounded page budget');const ref='sense:page:v4:'+digest(payload);if(!old.has(ref))await emit(ref,payload,expiresAt);else reused=true;refs.push(ref);page={};bytes=2;}
    for(const id of Object.keys(state.apps).sort()) {
      const app=state.apps[id],size=Buffer.byteLength(JSON.stringify(id))+Buffer.byteLength(JSON.stringify(app))+2;
      if(size>MANIFEST_PAGE_LIMIT-2)throw new Error('Game metadata exceeds the safe page size');
      if(bytes+size>MANIFEST_PAGE_LIMIT)await flush();
      page[id]=app;bytes+=size;
    }
    await flush();states[store]={...state,apps:{},appPages:refs,appPagesExpiresAt:reused && state.appPagesExpiresAt<expiresAt ? state.appPagesExpiresAt : expiresAt};
  }
  if(document.stores)output.stores=states;else Object.assign(output,states);
  return output;
}
