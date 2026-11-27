// @vitest-environment node
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const identity=vi.hoisted(()=>({user:{id:'editor-1',email:'editor@tripledotstudios.com',name:'Editor One',role:'editor'} as any}));
vi.mock('@/lib/auth',async importOriginal=>({
 ...await importOriginal<typeof import('@/lib/auth')>(),
 requireCurrentAppUser:async()=>{if(!identity.user)throw new Response('Unauthorized',{status:401});return identity.user;},
}));
import {GET,PUT} from '@/app/api/sound-studio/state/route';
import {POST,PATCH} from '@/app/api/sound-studio/uploads/route';
import {GET as getFile,PUT as putFile} from '@/app/api/sound-studio/files/[id]/route';
import {readSoundRecord} from '@/lib/sound-studio-store';
import {POST as importCatalog} from '@/app/api/sound-studio/catalog/route';
const directory=mkdtempSync(path.join(tmpdir(),'sound-studio-test-'));
const editor={...identity.user};
const request=(url:string,method='GET',body?:unknown)=>new Request('http://localhost'+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
const state=()=>({schemaVersion:3,revision:0,games:[{id:'game',name:'Test game',specStatus:'draft',cues:[]}],assets:[]});
beforeAll(()=>{
 for(const key of ['CEREBRAL_DATABASE_URL','DATABASE_URL','POSTGRES_URL','POSTGRES_PRISMA_URL','POSTGRES_URL_NON_POOLING','SOUND_STUDIO_STORAGE_URL','SOUND_STUDIO_STORAGE_KEY','SOUND_STUDIO_STORAGE_BUCKET'])vi.stubEnv(key,'');
 vi.stubEnv('SOUND_STUDIO_LOCAL_DB',path.join(directory,'test.sqlite'));
 vi.stubEnv('SOUND_STUDIO_MEDIA_DIR',path.join(directory,'media'));
});
afterAll(()=>{vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
describe('Sound Studio shared server',()=>{
 it('rejects anonymous and external readers and viewer writes',async()=>{
  identity.user=null;expect((await GET(request('/api/sound-studio/state'))).status).toBe(401);
  identity.user={...editor,email:'external@example.com'};expect((await GET(request('/api/sound-studio/state'))).status).toBe(403);
  identity.user={...editor,role:'viewer'};expect((await PUT(request('/api/sound-studio/state','PUT',state()))).status).toBe(403);
  identity.user=editor;
 });
 it('starts empty; saves a draft, assigns real author and rejects stale writes',async()=>{
  expect((await (await GET(request('/api/sound-studio/state'))).json()).games).toEqual([]);
  const saved=await PUT(request('/api/sound-studio/state','PUT',state()));expect(saved.status).toBe(200);
  const value=await saved.json();expect(value.revision).toBe(1);expect(value.games[0].createdBy).toBe('Editor One');
  expect((await PUT(request('/api/sound-studio/state','PUT',state()))).status).toBe(409);
  identity.user={...editor,id:'editor-2',name:'Editor Two'};
  const loaded=await (await GET(request('/api/sound-studio/state'))).json();expect(loaded).toEqual(value);
  loaded.games[0].name='Changed game';loaded.games[0].createdBy='Spoofed';
  const changed=await (await PUT(request('/api/sound-studio/state','PUT',loaded))).json();
  expect(changed.games[0].createdBy).toBe('Editor One');expect(changed.games[0].updatedBy).toBe('Editor Two');
  identity.user=editor;
 });
 it('allows only one concurrent save and blocks cross-origin writes',async()=>{
  const current=await (await GET(request('/api/sound-studio/state'))).json();
  const results=await Promise.all([PUT(request('/api/sound-studio/state','PUT',current)),PUT(request('/api/sound-studio/state','PUT',current))]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await PUT(new Request('http://localhost/api/sound-studio/state',{method:'PUT',headers:{origin:'https://other.example'},body:JSON.stringify(current)}))).status).toBe(403);
 });
 it('uploads privately, checks ownership, and supports media range requests',async()=>{
  const ticket=await (await POST(request('/api/sound-studio/uploads','POST',{name:'test.wav',size:13}))).json();
  const context={params:Promise.resolve({id:ticket.id})};
  expect((await getFile(request(ticket.url),context)).status).toBe(404);
  identity.user={...editor,id:'different'};
  expect((await putFile(new Request('http://localhost'+ticket.url,{method:'PUT',body:'RIFF1234WAVE'}),context)).status).toBe(403);
  identity.user=editor;
  const content=Buffer.from('RIFF1234WAVE!');
  expect((await putFile(new Request('http://localhost'+ticket.url,{method:'PUT',body:content}),context)).status).toBe(200);
  expect((await PATCH(request('/api/sound-studio/uploads','PATCH',{id:ticket.id}))).status).toBe(200);
  const full=await getFile(request(ticket.url),context);expect(Buffer.from(await full.arrayBuffer())).toEqual(content);
  const part=await getFile(new Request('http://localhost'+ticket.url,{headers:{range:'bytes=0-3'}}),context);expect(part.status).toBe(206);expect(await part.text()).toBe('RIFF');
  identity.user={...editor,role:'viewer'};
  expect((await GET(request('/api/sound-studio/state'))).status).toBe(200);
  const viewerFile=await getFile(request(ticket.url),context);expect(viewerFile.status).toBe(200);expect(Buffer.from(await viewerFile.arrayBuffer())).toEqual(content);
  const before=await (await GET(request('/api/sound-studio/state'))).json();
  expect((await PUT(request('/api/sound-studio/state','PUT',before))).status).toBe(403);
  expect((await POST(request('/api/sound-studio/uploads','POST',{name:'blocked.wav',size:13}))).status).toBe(403);
  expect((await PATCH(request('/api/sound-studio/uploads','PATCH',{id:ticket.id}))).status).toBe(403);
  expect((await putFile(new Request('http://localhost'+ticket.url,{method:'PUT',body:content}),context)).status).toBe(403);
  expect((await importCatalog(request('/api/sound-studio/catalog','POST',{}))).status).toBe(403);
  expect(await (await GET(request('/api/sound-studio/state'))).json()).toEqual(before);
  identity.user={...editor,email:'external@example.com'};expect((await getFile(request(ticket.url),context)).status).toBe(403);
  identity.user=null;expect((await getFile(request(ticket.url),context)).status).toBe(401);identity.user=editor;
  expect((await readSoundRecord<any>('file:'+ticket.id))?.value.ready).toBe(true);
 });
 it('allows internal admins to save and limits catalog imports to admins',async()=>{
  identity.user=editor;
  expect((await importCatalog(request('/api/sound-studio/catalog','POST',{schemaVersion:1,sounds:[]}))).status).toBe(403);
  identity.user={...editor,id:'admin-1',name:'Admin One',role:'admin'};
  const current=await (await GET(request('/api/sound-studio/state'))).json();
  expect((await PUT(request('/api/sound-studio/state','PUT',current))).status).toBe(200);
  expect((await importCatalog(request('/api/sound-studio/catalog','POST',{schemaVersion:1,sounds:[]}))).status).toBe(200);
  identity.user=editor;
 });
});
