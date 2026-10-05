/** Local-only demo proxy. Never forwards API requests; no credentials or upstream quota. */
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const fixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../tests/fixtures/ludios-sense-preview.json",import.meta.url)),"utf8"));
const port = Number(process.env.SENSE_PREVIEW_PORT ?? 3101);
const appPort = Number(process.env.SENSE_APP_PORT ?? 3100);
const today = () => new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const jobKey = `sense:v1:${"a".repeat(64)}`;
const generatedAt = new Date().toISOString();
const palette = ["#ffb340","#7395ff","#af79fa","#49b4a3","#ea8193","#72b6ec","#c49b49","#826be5"];
const symbols = ["🚌","🐶","🧩","🚀","🍕","🐱","🏹","🎲","💎","🌼","🚗","🏰"];
const games = fixture.map((game,index) => ({
 ...game,iconUrl:`http://127.0.0.1:${port}/__sense_icon/${index}`,unifiedAppId:game.unifiedAppId ?? null,
 releaseDate:null,url:"https://example.com",history:[],historyLoaded:false,
 availableCountries:["US","JP","CA","RU","DE","AU","GB"],unavailableCountries:[],retrievedAt:generatedAt,
 evaluation:{date:today(),variant:null,latest:game.latest,recentAverage:game.latest,baseline:1000,growth:game.signal === "none" ? null : game.latest/1000,added:game.signal === "none" ? null : game.latest-1000,flags:[],activityDate:null,releaseAge:null,signal:game.signal},
 ...(game.status ? {watch:{firstDetected:today(),lastDetected:today(),referenceAverage:game.latest,status:game.status,sourceJobKey:jobKey,sourceGeneratedAt:generatedAt,currentObserved:!game.missing}} : {}),
}));
const report = (filters={date:today(),countries:["AU","CA","DE","GB","JP","RU","US"]}) => ({jobKey,status:"completed",cached:true,requests:0,progress:"Local WIP · demo data",result:{filters:{...filters,countries:[...filters.countries].sort()},generatedAt,watermarks:{ios:today(),android:today()},games:games.filter(game=>!game.watch),errors:[],requests:0,coverageComplete:true,ruleVersion:"1.4-aggregate"}});
const json = (response,value,status=200) => { response.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});response.end(JSON.stringify(value)); };
const server = http.createServer(async(request,response) => {
 const path = new URL(request.url,"http://localhost").pathname;
 if(path.startsWith("/__sense_icon/")) {
  const index=Number(path.split("/").pop());
  response.writeHead(200,{"Content-Type":"image/svg+xml"});response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${palette[index%palette.length]}"/><stop offset="1" stop-color="#fff" stop-opacity=".3"/></linearGradient></defs><rect width="180" height="180" rx="24" fill="url(#g)"/><circle cx="90" cy="88" r="65" fill="white" opacity=".18"/><text x="90" y="120" font-size="92" text-anchor="middle">${symbols[index%symbols.length]}</text></svg>`);return;
 }
 if(path.startsWith("/api/")) {
  let body="";for await(const chunk of request) body+=chunk;
  let input={};try {input=JSON.parse(body || "{}");}catch{}
  if(path==="/api/me") return json(response,{authenticated:true,user:{name:"Local WIP · demo data",email:"No Sensor Tower calls",role:"admin"},access:{accountType:"internal",techLaunchApps:[]}});
  if(path==="/api/ludios-sense/cache") return json(response,{scan:report(input)});
  if(path==="/api/ludios-sense" || path==="/api/ludios-sense/status") return json(response,report(input.date ? input : undefined));
  if(path==="/api/ludios-sense/recent") return json(response,{games:games.filter(game=>game.watch)});
  if(path==="/api/ludios-sense/usage") return json(response,{usage:{month:today().slice(0,7),used:0,limit:10000,remaining:10000,trackingStartedAt:generatedAt},knownGames:games.length,knownHistoryCalls:0,knownMetadataCalls:0,note:"Mock preview"});
  if(path==="/api/ludios-sense/icons") return json(response,{icons:{},unifiedIds:{},requests:0});
  if(path==="/api/ludios-sense/game") {
   const game=games.find(game=>game.appId===input.appId && game.store===input.store);
   if(!game) return json(response,{error:"Demo game unavailable"},404);
   return json(response,{...game,historyLoaded:true,history:Array.from({length:28},(_,index)=>({date:new Date(Date.parse(today())-(27-index)*86400000).toISOString().slice(0,10),downloads:index===10 ? null : Math.round(1000+index/27*(game.latest-1000))}))});
  }
  return json(response,{error:"API disabled in local mock preview"},404);
 }
 const upstream=http.request({hostname:"127.0.0.1",port:appPort,path:request.url,method:request.method,headers:{...request.headers,host:`127.0.0.1:${appPort}`}},remote=>{response.writeHead(remote.statusCode,remote.headers);remote.pipe(response);});
 upstream.on("error",()=>{response.writeHead(502);response.end("Start the local Next.js app on port "+appPort);});request.pipe(upstream);
});
server.listen(port,"127.0.0.1",()=>console.log(`Local WIP demo: http://127.0.0.1:${port}/ludios-sense (API requests mocked)`));
