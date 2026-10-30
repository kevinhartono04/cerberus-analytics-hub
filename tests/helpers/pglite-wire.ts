import {Duplex} from "node:stream";
import type {PGlite} from "@electric-sql/pglite";

/** In-memory PostgreSQL transport: use the real postgres.js encoder/parser without a TCP port. */
export class PGliteWire extends Duplex {
  readyState="open";
  private startup=true;
  constructor(readonly pg:PGlite){super();}
  _read(){}
  _write(chunk:Buffer,_encoding:BufferEncoding,done:(error?:Error|null)=>void){
    void this.handle(chunk).then(()=>done(),done);
  }
  private async handle(chunk:Buffer){
    await new Promise<void>(resolve=>setImmediate(resolve));
    if(this.startup){
      this.startup=false;
      const message=(type:string,payload:Buffer)=>{const header=Buffer.alloc(5);header.write(type);header.writeInt32BE(payload.length+4,1);return Buffer.concat([header,payload]);};
      this.push(Buffer.concat([message("R",Buffer.alloc(4)),message("S",Buffer.from("server_version\x0017.0\x00")),message("S",Buffer.from("client_encoding\x00UTF8\x00")),message("K",Buffer.alloc(8)),message("Z",Buffer.from("I"))]));
      return;
    }
    if(chunk[0]===88){this.readyState="closed";this.push(null);this.destroy();return;}
    const response=await this.pg.execProtocolRaw(chunk,{syncToFs:false});
    if(response.length)this.push(Buffer.from(response));
  }
}
