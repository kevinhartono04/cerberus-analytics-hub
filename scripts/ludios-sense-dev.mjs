/** Dedicated local build cache so this WIP does not interfere with another dev server. */
import http from "node:http";
import next from "next";
const port = Number(process.env.SENSE_APP_PORT ?? 3100);
const app = next({dev:true,hostname:"127.0.0.1",port,conf:{distDir:".next-sense-wip"}});
await app.prepare();
const handle = app.getRequestHandler();
http.createServer((request,response)=>handle(request,response)).listen(port,"127.0.0.1",()=>console.log(`Isolated local app: http://127.0.0.1:${port}`));
