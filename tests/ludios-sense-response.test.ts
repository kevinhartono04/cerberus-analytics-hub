// @vitest-environment node
import {expect,it} from 'vitest';
import {senseJsonResponse} from '../lib/ludios-sense-response';
it('streams a report larger than the buffered hosting limit without corrupting Unicode',async()=>{
 const value={games:Array.from({length:6000},(_,i)=>({id:i,title:'🎮'.repeat(240)}))};
 expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(4.5*1024*1024);
 const response=senseJsonResponse(value);
 expect(response.headers.get('content-length')).toBeNull();
 expect(await response.json()).toEqual(value);
});
