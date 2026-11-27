import {requireCurrentAppUser,assertInternalAppUser,canCreateSpec} from "./auth";
export async function soundUser(request?:Request,write=false){
  const user=await requireCurrentAppUser(request);assertInternalAppUser(user);
  if(write && !canCreateSpec(user))throw Response.json({error:"An Editor or Admin role is required to change Sound Studio."},{status:403});
  if(write && request){const origin=request.headers.get("origin");if(origin && origin!==new URL(request.url).origin)throw new Response("Invalid origin",{status:403});}
  return user;
}
export function soundError(error:unknown){
  if(error instanceof Response)return error;
  console.error("Sound Studio request failed",error instanceof Error ? error.message : "Unknown error");
  return Response.json({error:"Sound Studio could not complete this request. Check the server configuration or retry."},{status:500});
}
