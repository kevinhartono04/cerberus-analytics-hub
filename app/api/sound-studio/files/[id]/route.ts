import fs from "node:fs/promises";
import path from "node:path";
import {soundUser,soundError} from "@/lib/sound-studio-access";
import {readMedia,mediaDirectory,storageConfig,storageRequest,MAX_FILE} from "@/lib/sound-studio-media";
type Context={params:Promise<{id:string}>};
export const dynamic="force-dynamic";
export async function PUT(request:Request,context:Context){try{
 const user=await soundUser(request,true);if(storageConfig())return new Response("Use the signed upload URL",{status:400});
 const {id}=await context.params,record=await readMedia(id);
 if(record.value.owner!==user.id || record.value.ready)return new Response("Forbidden",{status:403});
 const chunks:Uint8Array[]=[];let size=0;
 const reader=request.body?.getReader();if(!reader)return new Response("Empty file",{status:400});
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX_FILE || size>record.value.size){await reader.cancel();return new Response("File is too large",{status:413});}chunks.push(part.value);}
 if(size!==record.value.size)return new Response("Incomplete upload",{status:400});
 await fs.mkdir(mediaDirectory(),{recursive:true});await fs.writeFile(path.join(mediaDirectory(),id),Buffer.concat(chunks),{flag:"wx"});
 return Response.json({ok:true});
}catch(e){return soundError(e);}}
export async function GET(request:Request,context:Context){try{
 await soundUser(request);const {id}=await context.params,record=await readMedia(id);
 if(!record.value.ready)return new Response("Upload not completed",{status:404});
 const config=storageConfig();
 if(config){const signed=await storageRequest(`/object/sign/${config.bucket}/${id}`,{expiresIn:120});return new Response(null,{status:307,headers:{Location:new URL('/storage/v1'+signed.signedURL,config.url).href,"Cache-Control":"private, no-store"}});}
 const bytes=await fs.readFile(path.join(mediaDirectory(),id));
 const headers:Record<string,string>={"Content-Type":record.value.type,"Cache-Control":"private, no-store","Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff"};
 const range=request.headers.get('range');
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start=m?.[1]?Number(m[1]):0,end=m?.[2]?Number(m[2]):bytes.length-1;if(m && !m[1] && m[2]){start=Math.max(0,bytes.length-Number(m[2]));end=bytes.length-1;}if(!m || start>end || start>=bytes.length)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${bytes.length}`}});end=Math.min(end,bytes.length-1);headers["Content-Range"]=`bytes ${start}-${end}/${bytes.length}`;headers["Content-Length"]=String(end-start+1);return new Response(new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers});}
 headers["Content-Length"]=String(bytes.length);return new Response(new Uint8Array(bytes),{headers});
}catch(e){return soundError(e);}}
