/** Stream bounded summaries so large saved reports do not hit the hosting buffered-response cap. */
export function senseJsonResponse(value: unknown) {
  const json=JSON.stringify(value);
  if(Buffer.byteLength(json)>32*1024*1024)throw new Error('Report exceeds the safe response budget');
  const encoder=new TextEncoder();let offset=0;
  const body=new ReadableStream<Uint8Array>({
    pull(controller){
      if(offset===json.length){controller.close();return;}
      let end=Math.min(offset+16384,json.length);
      if(end<json.length && json.charCodeAt(end-1)>=0xd800 && json.charCodeAt(end-1)<=0xdbff)end--;
      controller.enqueue(encoder.encode(json.slice(offset,end)));offset=end;
    }
  });
  return new Response(body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});
}
