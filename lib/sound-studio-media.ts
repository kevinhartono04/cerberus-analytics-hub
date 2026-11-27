import path from "node:path";
import fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {readSoundRecord,writeSoundRecord} from "./sound-studio-store";
export const MAX_FILE=50*1024*1024;
export const mediaTypes:Record<string,string>={wav:"audio/wav",mp3:"audio/mpeg",ogg:"audio/ogg",m4a:"audio/mp4",mp4:"video/mp4",webm:"video/webm",mov:"video/quicktime"};
export type MediaRecord={id:string;name:string;size:number;type:string;owner:string;createdAt:string;ready:boolean};
export const validMediaId=(id:string)=>/^[a-f0-9-]{36}\.(wav|mp3|ogg|m4a|mp4|webm|mov)$/.test(id);
export function mediaDirectory(){return process.env.SOUND_STUDIO_MEDIA_DIR || path.join(process.cwd(),"data","sound-studio-media");}
export function storageConfig(){
 const url=process.env.SOUND_STUDIO_STORAGE_URL,key=process.env.SOUND_STUDIO_STORAGE_KEY,bucket=process.env.SOUND_STUDIO_STORAGE_BUCKET;
 if(url && key && bucket){const u=new URL(url);if(u.protocol!=="https:" || !/^[a-z0-9_.-]+$/i.test(bucket))throw Error("Invalid Sound Studio storage configuration");return {url:url.replace(/\/$/,""),key,bucket};}
 if(process.env.NODE_ENV==="production")throw Error("Private Sound Studio file storage is not configured.");
 return null;
}
export async function storageRequest(endpoint:string,body?:unknown,method="POST"){
 const config=storageConfig();if(!config)throw Error("Storage is not configured");
 const response=await fetch(config.url+"/storage/v1"+endpoint,{method,headers:{Authorization:`Bearer ${config.key}`,apikey:config.key,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:"no-store"});
 if(!response.ok)throw Error("Private file storage request failed ("+response.status+").");
 return response.json();
}
export async function createUpload(name:string,size:number,owner:string){
 const extension=name.split('.').pop()?.toLowerCase() || '',type=mediaTypes[extension];
 if(!type || !name || name.length>240 || !Number.isInteger(size) || size<1 || size>MAX_FILE)throw new Response("Choose a supported audio or video file under 50 MB.",{status:400});
 const config=storageConfig();
 if(config){const bucket=await storageRequest(`/bucket/${config.bucket}`,undefined,"GET");if(bucket.public!==false)throw Error("Sound Studio requires a private storage bucket.");}
 const id=randomUUID()+'.'+extension;
 const record:MediaRecord={id,name,size,type,owner,createdAt:new Date().toISOString(),ready:false};
 const signed=config ? await storageRequest(`/object/upload/sign/${config.bucket}/${id}`,{}) : null;
 await writeSoundRecord('file:'+id,record,0);
 const uploadUrl=config ? new URL('/storage/v1'+signed.url,config.url).href : '/api/sound-studio/files/'+id;
 return {id,url:'/api/sound-studio/files/'+id,uploadUrl,type};
}
export async function readMedia(id:string){
 if(!validMediaId(id))throw new Response("Not found",{status:404});
 const record=await readSoundRecord<MediaRecord>('file:'+id);
 if(!record)throw new Response("Not found",{status:404});return record;
}
export async function completeMedia(id:string,owner:string){
 const record=await readMedia(id);
 if(record.value.owner!==owner)throw new Response("Forbidden",{status:403});
 if(record.value.ready)return;
 const config=storageConfig();let size:number;
 if(config){const info=await storageRequest(`/object/info/${config.bucket}/${id}`,undefined,"GET");size=Number(info.metadata?.size ?? info.size);}
 else size=(await fs.stat(path.join(mediaDirectory(),id))).size;
 if(size!==record.value.size)throw new Response("The uploaded file size does not match. Please upload it again.",{status:400});
 if(!await writeSoundRecord('file:'+id,{...record.value,ready:true},record.revision))throw new Response("Upload changed. Retry.",{status:409});
}
