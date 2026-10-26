// @vitest-environment node
import {expect,it} from 'vitest';
import {pageSenseManifest,MANIFEST_PAGE_LIMIT} from '../lib/ludios-sense-codec.mjs';
it('pages large metadata deterministically without extending reused-page lifetime',async()=>{
 const apps=Object.fromEntries(Array.from({length:1200},(_,i)=>[String(i),{title:'x'.repeat(1000),histories:{}}]));
 const records=new Map<string,string>();
 const oldExpiry=new Date(Date.now()+60*86400000).toISOString();
 const newExpiry=new Date(Date.now()+93*86400000).toISOString();
 const root:any=await pageSenseManifest({stores:{android:{apps},ios:{apps:{}}}},async(k:string,p:string)=>{records.set(k,p)},oldExpiry);
 expect(root.stores.android.appPages.length).toBeGreaterThan(1);
 expect([...records.values()].every(p=>Buffer.byteLength(p)<=MANIFEST_PAGE_LIMIT)).toBe(true);
 const recovered=Object.assign({},...root.stores.android.appPages.map((ref:string)=>JSON.parse(records.get(ref)!)));
 expect(recovered).toEqual(apps);
 const again:any=await pageSenseManifest({stores:{android:{...root.stores.android,apps:recovered},ios:{apps:{}}}},async()=>{throw new Error('unchanged page rewritten')},newExpiry);
 expect(again.stores.android.appPagesExpiresAt).toBe(oldExpiry);
});
it('pages a multi-megabyte report without losing game order',async()=>{
 const games=Array.from({length:6000},(_,i)=>({appId:String(i),title:'x'.repeat(900),history:[],historyLoaded:false}));
 const pages=new Map<string,string>();
 const root:any=await pageSenseManifest({result:{generatedAt:'2026-10-20',games}},async(k:string,p:string)=>{pages.set(k,p)},'2099-01-01');
 expect(Buffer.byteLength(JSON.stringify(root))).toBeLessThan(4*1024*1024);
 expect([...pages.values()].every(p=>Buffer.byteLength(p)<=MANIFEST_PAGE_LIMIT)).toBe(true);
 expect(root.result.gamePages.flatMap((ref:string)=>JSON.parse(pages.get(ref)!))).toEqual(games);
});
