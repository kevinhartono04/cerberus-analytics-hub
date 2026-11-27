import {readFile} from "node:fs/promises";
import path from "node:path";
import {soundUser,soundError} from "@/lib/sound-studio-access";
import {readSoundRecord,writeSoundRecord} from "@/lib/sound-studio-store";
import {normalizeLibraryReference} from "@/components/sound-studio/workspace/model";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{
 await soundUser(request);
 const saved=await readSoundRecord("catalog");
 if(saved)return Response.json(saved.value,{headers:{"Cache-Control":"private, max-age=300"}});
 if(process.env.NODE_ENV!=="production")try{return new Response(await readFile(path.join(process.cwd(),"data/sound-studio/cerberator-catalog.json"),"utf8"),{headers:{"Content-Type":"application/json","Cache-Control":"private, max-age=300"}});}catch{}
 return Response.json({error:"The sound catalog has not been imported yet."},{status:503});
}catch(e){return soundError(e);}}
export async function POST(request:Request){try{
 const user=await soundUser(request,true);
 if(user.role!=="admin")return new Response("An Admin role is required to import the catalog.",{status:403});
 const raw=await request.text();if(Buffer.byteLength(raw)>3*1024*1024)return new Response("Catalog is too large",{status:413});
 let catalog;
 try{const body=JSON.parse(raw);if(body.schemaVersion!==1 || !Array.isArray(body.sounds) || body.sounds.length>10000)throw Error();const sounds=body.sounds.map(normalizeLibraryReference);if(new Set(sounds.map((s:any)=>s.id)).size!==sounds.length)throw Error();catalog={schemaVersion:1,importedOn:new Date().toISOString(),sounds};}catch{return new Response("Invalid catalog",{status:400});}
 const old=await readSoundRecord("catalog");
 if(!await writeSoundRecord("catalog",catalog,old?.revision || 0))return new Response("Catalog changed. Retry.",{status:409});
 return Response.json({ok:true,count:catalog.sounds.length});
}catch(e){return soundError(e);}}
