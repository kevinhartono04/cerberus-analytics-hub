async function responseJSON(response){
 const body=await response.json().catch(()=>null);
 if(!response.ok)throw Error(body?.error || (response.status===401?'Sign in to Cerebral to open Sound Studio.':'The request could not be completed.'));
 return body;
}
export const serverRepository={
 async load(){return responseJSON(await fetch('/api/sound-studio/state',{cache:'no-store'}));},
 async save(state){return responseJSON(await fetch('/api/sound-studio/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)}));},
 async upload(file){
  const ticket=await responseJSON(await fetch('/api/sound-studio/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,size:file.size})}));
  const result=await fetch(ticket.uploadUrl,{method:'PUT',headers:{'Content-Type':ticket.type},body:file});
  if(!result.ok)throw Error('File upload failed. Retry before saving.');
  await responseJSON(await fetch('/api/sound-studio/uploads',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:ticket.id})}));
  return {url:ticket.url};
 }
};
