import {soundUser,soundError} from "@/lib/sound-studio-access";
import {readSoundRecord,writeSoundRecord} from "@/lib/sound-studio-store";
import {validateState,stampAudit,type SoundState} from "@/components/sound-studio/workspace/model";
export const dynamic="force-dynamic";
const empty=()=>({schemaVersion:3,revision:0,games:[],assets:[],videos:[]});
export async function GET(request:Request){try{
  await soundUser(request);
  const record=await readSoundRecord<SoundState>("state");
  return Response.json(record ? {...record.value,revision:record.revision} : empty(),{headers:{"Cache-Control":"no-store"}});
}catch(e){return soundError(e);}}
export async function PUT(request:Request){try{
  const user=await soundUser(request,true);
  const raw=await request.text();
  if(Buffer.byteLength(raw)>3*1024*1024)return Response.json({error:"Sound list metadata exceeds 3 MB."},{status:413});
  let next:SoundState;
  try{next=validateState(JSON.parse(raw));}catch(e){return Response.json({error:e instanceof Error?e.message:"Invalid sound list"},{status:400});}
  // Embedded audio/video makes saves huge and cannot be shared reliably.
  if(/data:(audio|video)\//i.test(raw))return Response.json({error:"Upload audio and video files before saving."},{status:400});
  const record=await readSoundRecord<SoundState>("state");
  if(next.revision!==(record?.revision || 0))return Response.json({error:"Someone saved a newer version. Reload the saved list before applying your changes."},{status:409});
  const saved=stampAudit(next,record?.value || empty(),user.name || user.email);
  saved.revision=next.revision+1;
  if(!await writeSoundRecord("state",saved,next.revision))return Response.json({error:"Someone saved a newer version. Reload before saving."},{status:409});
  return Response.json(saved,{headers:{"Cache-Control":"no-store"}});
}catch(e){return soundError(e);}}
