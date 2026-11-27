import { cueAudioIds, cueVideos, driveLink } from './cue-media.js';

export function specFiles(game, assets) {
  return uniqueDownloads(game.cues.flatMap(cue => [
    ...cueAudioIds(cue).map(id => assets.find(a => a.id === id)).filter(Boolean).map(a => ({url:a.audioUrl,name:a.name,type:'audio'})),
    ...cueVideos(cue).map(v => ({url:v.url,name:v.name || cue.name+'.mp4',type:'video'})),
  ]));
}
export function uniqueDownloads(files) {
  return [...new Map(files.filter(f=>f.url).map(f=>[f.url,f])).values()];
}
export function canDownloadFile(file) {
  if(!file.url || driveLink(file.url))return false;
  try {
    const u=new URL(file.url,'https://sound-studio.invalid');
    if(['drive.google.com','docs.google.com','youtube.com','www.youtube.com','youtu.be','vimeo.com','www.vimeo.com'].includes(u.hostname))return false;
    return ['http:','https:','blob:'].includes(u.protocol) || /^data:(audio|video)\//i.test(file.url);
  } catch {return false;}
}
export function uniqueDownloadNames(files) {
  const used=new Set();
  return files.map((file,index)=>{
    let name=(file.name || `${file.type || 'file'}-${index+1}`).replace(/[\x00-\x1f/\\:*?"<>|]/g,'_').replace(/^\.+/,'').trim() || `file-${index+1}`;
    if(!/\.(wav|mp3|ogg|m4a|mp4|mov|webm)$/i.test(name)) {
      const extension=file.url.match(/\.(wav|mp3|ogg|m4a|mp4|mov|webm)(?:[?#]|$)/i)?.[1];
      if(extension)name+='.'+extension;
    }
    const dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
    let candidate=name,n=2;
    while(used.has(candidate.toLowerCase()))candidate=`${stem} (${n++})${ext}`;
    used.add(candidate.toLowerCase());return candidate;
  });
}
export async function downloadArchive(files,{signal,onProgress=()=>{},fetchFile=fetch,maxBytes=200*1024*1024}={}) {
  const selected=uniqueDownloads(files);
  if(!selected.length)throw Error('Select at least one file.');
  if(selected.length>200)throw Error('Choose up to 200 files per ZIP.');
  const names=uniqueDownloadNames(selected),entries={},failures=[];
  let total=0;
  for(let i=0;i<selected.length;i++){
    if(signal?.aborted)throw new DOMException('Download canceled.','AbortError');
    const file=selected[i];onProgress(i,selected.length);
    if(!canDownloadFile(file)){failures.push(file.name+' — source access required');continue;}
    const controller=new AbortController(),cancel=()=>controller.abort();
    signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(cancel,30000);
    try{
      // Cerebral media requires the session cookie; never send it to external sources.
      const response=await fetchFile(file.url,{signal:controller.signal,credentials:'same-origin'});
      if(!response.ok)throw Error('source unavailable');
      const type=response.headers.get('content-type') || '';
      if(/text\/|json|xml/i.test(type))throw Error('source returned a page, not a media file');
      const expected=Number(response.headers.get('content-length') || 0);
      if(expected>50*1024*1024 || total+expected>maxBytes)throw Error('download size limit exceeded');
      const chunks=[];let size=0;
      if(response.body?.getReader){
        const reader=response.body.getReader();
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>50*1024*1024 || total+size>maxBytes)throw Error('download size limit exceeded');chunks.push(value);}}
        catch(e){await reader.cancel();throw e;}
      }else{const bytes=new Uint8Array(await response.arrayBuffer());size=bytes.length;chunks.push(bytes);}
      if(!size || size>50*1024*1024 || total+size>maxBytes)throw Error('empty file or download size limit exceeded');
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      if(/^\s*(<!doctype|<html|<\?xml)/i.test(new TextDecoder().decode(bytes.slice(0,128))))throw Error('source returned a page, not a media file');
      entries[names[i]]=bytes;total+=size;
    }catch(e){if(signal?.aborted)throw new DOMException('Download canceled.','AbortError');failures.push(`${file.name} — ${e.message || 'could not download'}`);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  onProgress(selected.length,selected.length);
  if(signal?.aborted)throw new DOMException('Download canceled.','AbortError');
  const count=Object.keys(entries).length;
  if(!count)return {bytes:null,count:0,failures};
  const {zip}=await import('fflate');
  const bytes=await new Promise((resolve,reject)=>zip(entries,{level:0},(error,data)=>error?reject(error):resolve(data)));
  if(signal?.aborted)throw new DOMException('Download canceled.','AbortError');
  return {bytes,count,failures};
}
