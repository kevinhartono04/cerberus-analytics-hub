import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {downloadArchive,uniqueDownloadNames,canDownloadFile,specFiles} from '../components/sound-studio/workspace/download-files.js';
import {resizeColumn,normalizedWidths,DEFAULT_WIDTHS,MIN_WIDTHS,validWidths} from '../components/sound-studio/workspace/column-widths.js';
const a={url:'/a.wav',name:'tap.wav',type:'audio'},b={url:'/b.wav',name:'tap.wav',type:'audio'};
test('ZIP contains exact selected bytes, preserves duplicate filenames and excludes unselected files',async()=>{
 const calls=[];const result=await downloadArchive([a,b],{fetchFile:async url=>{calls.push(url);return new Response(new Uint8Array([url==='/a.wav'?1:2,3]),{headers:{'content-type':'audio/wav'}});}});
 assert.deepEqual(calls,['/a.wav','/b.wav']);assert.equal(result.count,2);assert.deepEqual(result.failures,[]);
 const files=unzipSync(result.bytes);assert.deepEqual(Object.keys(files),['tap.wav','tap (2).wav']);assert.deepEqual([...files['tap.wav']],[1,3]);
});
test('Drive links are never fetched; HTML responses are not saved as audio',async()=>{
 let count=0;const drive={url:'https://drive.google.com/file/d/restricted/view',name:'restricted.wav'};
 assert.equal(canDownloadFile(drive),false);
 const result=await downloadArchive([drive,a],{fetchFile:async()=>{count++;return new Response('<html>login</html>',{headers:{'content-type':'application/octet-stream'}});}});
 assert.equal(count,1);assert.equal(result.count,0);assert.equal(result.bytes,null);assert.equal(result.failures.length,2);
});
test('partial ZIP reports failures and retains only successfully retrieved originals',async()=>{
 const result=await downloadArchive([a,b],{fetchFile:async url=>url===a.url?new Response(new Uint8Array([9]),{headers:{'content-type':'audio/wav'}}):new Response('',{status:403})});
 assert.equal(result.count,1);assert.equal(result.failures.length,1);assert.deepEqual(Object.keys(unzipSync(result.bytes)),['tap.wav']);
});
test('archive enforces total size and cancellation',async()=>{
 const result=await downloadArchive([a],{maxBytes:2,fetchFile:async()=>new Response(new Uint8Array([1,2,3]))});assert.equal(result.count,0);
 const controller=new AbortController();controller.abort();await assert.rejects(downloadArchive([a],{signal:controller.signal}),e=>e.name==='AbortError');
});
test('names cannot create zip directories and case-insensitive collisions get a suffix',()=>{
 const names=uniqueDownloadNames([{...a,name:'../tap.wav'},a,{...a,name:'TAP.wav'}]);assert.equal(names.some(n=>n.includes('/')||n.includes('\\')),false);assert.equal(new Set(names.map(n=>n.toLowerCase())).size,3);
});
test('spec download lists include multiple audio and video attachments without duplicates',()=>{
 const assets=[{id:'a',name:'a.wav',audioUrl:'/a.wav'},{id:'b',name:'b.wav',audioUrl:'/b.wav'}];
 const files=specFiles({cues:[{assetId:'a',extraAudioIds:['a','b'],videoUrl:'/v.mp4',extraVideos:[{url:'/v.mp4'}]},{assetId:'a'}]},assets);
 assert.equal(files.length,3);assert.equal(files.filter(f=>f.type==='audio').length,2);
});
test('resizing preserves table width, takes Notes space first, and respects minimum widths',()=>{
 const w=resizeColumn(DEFAULT_WIDTHS,0,3);assert.equal(w[0],21);assert.equal(w[5],5);assert.equal(w.reduce((a,b)=>a+b,0),100);
 const max=resizeColumn(DEFAULT_WIDTHS,0,100);assert.ok(max.every((v,i)=>v>=MIN_WIDTHS[i]));assert.equal(max.reduce((a,b)=>a+b,0),100);
 const narrower=resizeColumn(DEFAULT_WIDTHS,5,-100);assert.equal(narrower[5],4);assert.equal(narrower[0],22);
});
test('viewer column widths normalize and reject invalid stored preferences',()=>{
 const w=normalizedWidths(DEFAULT_WIDTHS.slice(0,6));assert.ok(validWidths(w,6));assert.equal(validWidths(w,7),false);assert.equal(validWidths([NaN,0],2),false);
});
