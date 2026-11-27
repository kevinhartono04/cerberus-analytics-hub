import {soundUser,soundError} from "@/lib/sound-studio-access";
import {createUpload,completeMedia} from "@/lib/sound-studio-media";
export async function POST(request:Request){try{const user=await soundUser(request,true);const body=await request.json();return Response.json(await createUpload(body.name,body.size,user.id));}catch(e){return soundError(e);}}
export async function PATCH(request:Request){try{const user=await soundUser(request,true);const body=await request.json();await completeMedia(body.id,user.id);return Response.json({ok:true});}catch(e){return soundError(e);}}
