import React from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { senseToday } from "@/lib/ludios-sense-types";
import LudiosSense from "@/components/LudiosSense";
vi.mock("@/components/CerberusShell",()=>({default:({children}:{children:React.ReactNode})=><main>{children}</main>}));
beforeEach(()=>{
 sessionStorage.clear();vi.unstubAllGlobals();
 HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open",""); };
 HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
});
describe("Sense page",()=>{
 it("shows a saved breakout by default and separates it from current signals",async()=>{
  const date=senseToday(),jobKey="sense:v1:"+"a".repeat(64),generatedAt=new Date().toISOString();
  const game={appId:"rings",store:"ios",name:"Rotate Rings",publisher:"Studio",genre:"Puzzle",classification:"included",releaseDate:null,iconUrl:null,unifiedAppId:null,url:"https://example.com",history:[],availableCountries:["US"],unavailableCountries:[],evaluation:{date,signal:"none",latest:86722,recentAverage:90133,baseline:null,growth:null,added:null,flags:[],releaseAge:null,activityDate:null},retrievedAt:generatedAt};
  const watched={...game,watch:{firstDetected:"2026-09-29",lastDetected:"2026-09-29",referenceAverage:99090,status:"holding_scale",sourceJobKey:jobKey,sourceGeneratedAt:generatedAt,currentObserved:true}};
  const scan={jobKey,status:"completed",cached:true,requests:64,progress:"Complete",result:{filters:{date,countries:["AU","CA","DE","GB","JP","RU","US"]},games:[game],generatedAt,watermarks:{ios:date},coverageComplete:true}};
  const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith("/cache")?{scan}:url.endsWith("/recent")?{games:[watched]}:url.endsWith("/game")?game:{}));
  vi.stubGlobal("fetch",fetch);render(<LudiosSense/>);
  await waitFor(()=>expect(screen.getByRole("heading",{name:"Holding scale"})).toBeInTheDocument());
  expect(screen.getByRole("button",{name:/Worth attention/})).toHaveAttribute("aria-pressed","true");
  expect(screen.getByRole("button",{name:"Inspect Rotate Rings, ios"})).toBeInTheDocument();
  expect(screen.queryByText(/Detected 2026-09-29/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/Current signals/}));
  expect(screen.queryByRole("button",{name:"Inspect Rotate Rings, ios"})).not.toBeInTheDocument();
  expect(fetch.mock.calls.every(([url])=>["/api/ludios-sense/cache","/api/ludios-sense/usage","/api/ludios-sense/recent","/api/ludios-sense/game"].includes(url))).toBe(true);
 });
 it("bounds stalled history requests, marks the shortlist incomplete, and retries only saved detections",async()=>{
  vi.useFakeTimers();
  const date=senseToday(),generatedAt=new Date().toISOString(),jobKey="sense:v1:"+"a".repeat(64);
  const game={appId:"rings",store:"ios",name:"Rotate Rings",publisher:"Studio",genre:"Puzzle",classification:"included",iconUrl:null,unifiedAppId:null,url:"https://example.com",history:[],availableCountries:["US"],unavailableCountries:[],evaluation:{date,signal:"none",latest:86722,recentAverage:90133,flags:[]},retrievedAt:generatedAt,watch:{firstDetected:date,lastDetected:date,referenceAverage:99090,status:"holding_scale",sourceJobKey:jobKey,sourceGeneratedAt:generatedAt,currentObserved:true}};
  let ready=false;
  const fetch=vi.fn(async(url:string)=>{
   if(url.endsWith("/cache"))return Response.json({scan:{jobKey,status:"completed",cached:true,requests:64,progress:"Complete",result:{filters:{date,countries:["AU","CA","DE","GB","JP","RU","US"]},games:[],generatedAt,watermarks:{ios:date},coverageComplete:true}}});
   if(url.endsWith("/recent"))return ready?Response.json({games:[game]}):new Promise<Response>(()=>{});
   return Response.json({});
  });
  vi.stubGlobal("fetch",fetch);const view=render(<LudiosSense/>);
  try {
   await act(()=>vi.advanceTimersByTimeAsync(400));
   expect(screen.getByRole("status")).toHaveTextContent("shortlist is incomplete");
   expect(screen.getByRole("button",{name:/Worth attention/})).toHaveTextContent("…");
   await act(()=>vi.advanceTimersByTimeAsync(40000));
   expect(screen.getByRole("alert")).toHaveTextContent("shortlist is incomplete");
   expect(screen.queryByRole("status")).not.toBeInTheDocument();
   expect(fetch.mock.calls.filter(([url])=>url.endsWith("/recent"))).toHaveLength(2);
   ready=true;fireEvent.click(screen.getByRole("button",{name:"Retry saved detections"}));
   await act(()=>vi.advanceTimersByTimeAsync(1));
   expect(screen.getByRole("button",{name:"Inspect Rotate Rings, ios"})).toBeInTheDocument();
   expect(screen.queryByRole("alert")).not.toBeInTheDocument();
   expect(fetch.mock.calls.every(([url])=>["/api/ludios-sense/cache","/api/ludios-sense/usage","/api/ludios-sense/recent"].includes(url))).toBe(true);
  }finally{view.unmount();vi.useRealTimers();}
 });
 it("uses today's limit when cached HTML was rendered on a previous day",()=>{
  vi.useFakeTimers();
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({scan:null})));
  vi.setSystemTime(new Date("2026-10-01T03:00:00Z"));
  const container=document.createElement("div");
  container.innerHTML=renderToString(<LudiosSense/>);
  document.body.appendChild(container);
  vi.setSystemTime(new Date("2026-10-02T03:00:00Z"));
  const view=render(<LudiosSense/>,{container,hydrate:true});
  try {expect(screen.getByLabelText("Date (t)")).toHaveAttribute("max","2026-10-02");}
  finally {view.unmount();container.remove();vi.useRealTimers();}
 });
 it("updates the WIB date limit overnight and on return without replacing a selected historical date",()=>{
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T16:59:30Z"));
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({scan:null})));
  const view=render(<LudiosSense/>);
  try {
   const input=screen.getByLabelText("Date (t)");
   expect(input).toHaveAttribute("max","2026-10-01");
   fireEvent.change(input,{target:{value:"2026-09-25"}});
   vi.setSystemTime(new Date("2026-10-01T17:01:00Z"));
   fireEvent.focus(window);
   expect(input).toHaveAttribute("max","2026-10-02");
   expect(input).toHaveValue("2026-09-25");
   vi.setSystemTime(new Date("2026-10-02T17:01:00Z"));
   fireEvent(document,new Event("visibilitychange"));
   expect(input).toHaveAttribute("max","2026-10-03");
   expect(input).toHaveValue("2026-09-25");
  } finally {view.unmount();vi.useRealTimers();}
 });
 it("defaults to today and seven selected markets, sends unchecked selection, and renders the completed report",async()=>{
  const fetch=vi.fn(async(_url:string,init:RequestInit)=>{if(_url.endsWith("/cache"))return Response.json({scan:null});const filters=JSON.parse(init.body as string);return Response.json({jobKey:"sense:v1:"+"a".repeat(64),status:"completed",requests:12,progress:"Check complete",result:{filters:{...filters,countries:[...filters.countries].sort()},games:[],generatedAt:new Date().toISOString(),watermarks:{ios:"2026-09-28",android:"2026-09-28"},coverageComplete:true,errors:[],ruleVersion:"1.4-aggregate",requests:12}});});
  vi.stubGlobal("fetch",fetch);render(<LudiosSense/>);
  expect(screen.getByLabelText("Date (t)")).toHaveValue(senseToday());
  fireEvent.click(screen.getByText(/Markets/));
  expect(screen.getAllByRole("checkbox")).toHaveLength(7);screen.getAllByRole("checkbox").forEach(c=>expect(c).toBeChecked());
  fireEvent.click(screen.getByRole("checkbox",{name:"Japan"}));fireEvent.click(screen.getByRole("button",{name:"Run check"}));
  await waitFor(()=>expect(screen.getByText("Research shortlist")).toBeInTheDocument());
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).countries).not.toContain("JP");
  fireEvent.click(screen.getByText("Report details"));
  expect(screen.getByText(/Requested t:/)).toHaveTextContent("2026-09-28");
 });
 it("loads a saved country subset after deselecting Japan without starting a scan or requesting app metadata",async()=>{
  const date=senseToday(),generatedAt=new Date().toISOString();
  const sourceCountries=["AU","CA","DE","GB","JP","RU","US"];
  const fetch=vi.fn(async(url:string,init:RequestInit)=>{
   const filters=JSON.parse(init.body as string);
   if(filters.countries)filters.countries.sort();
   if(url.endsWith("/cache"))return Response.json({scan:{jobKey:"sense:v1:"+"a".repeat(64),status:"completed",cached:true,requests:0,progress:"Complete",result:{filters,games:[],generatedAt,watermarks:{ios:date},coverageComplete:true,...(!filters.countries.includes("JP")?{reusedFrom:{jobKey:"sense:v1:"+"b".repeat(64),countries:sourceCountries,generatedAt}}:{})}}});
   if(url.endsWith("/usage"))return Response.json({usage:{month:"2026-10",used:20,limit:10000,remaining:9980},knownHistoryCalls:0,knownMetadataCalls:0,cachedReport:true});
   if(url.endsWith("/recent"))return Response.json({games:[]});
   throw new Error("Unexpected API work: "+url);
  });
  vi.stubGlobal("fetch",fetch);render(<LudiosSense/>);
  await waitFor(()=>expect(screen.getByText("Research shortlist")).toBeInTheDocument());
  fireEvent.click(screen.getByText(/Markets/));
  fireEvent.click(screen.getByRole("checkbox",{name:"Japan"}));
  await waitFor(()=>expect(screen.getByText(/Saved country data · 0 new calls/)).toBeInTheDocument());
  expect(screen.queryByText(/Filters changed/)).not.toBeInTheDocument();
  expect(screen.getByText(/source retrieved/)).toHaveTextContent("No new Sensor Tower calls");
  expect(fetch.mock.calls.some(([url,init])=>url.endsWith("/cache")&&!JSON.parse(init.body as string).countries.includes("JP"))).toBe(true);
  expect(fetch.mock.calls.every(([url])=>["/api/ludios-sense/cache","/api/ludios-sense/usage","/api/ludios-sense/recent"].includes(url))).toBe(true);
 });
 it("shows the monthly allowance and saved-candidate estimate without running a scan",async()=>{
  const fetch=vi.fn(async()=>Response.json({usage:{month:"2026-10",used:20,limit:10000,remaining:9980,trackingStartedAt:"2026-10-01T03:00:00Z",organizationUsed:200,organizationLimit:10000,organizationObservedAt:"2026-10-01T03:00:00Z"},knownGames:200,knownHistoryCalls:2,knownMetadataCalls:0,note:"Discovery and new games add calls"}));vi.stubGlobal("fetch",fetch);
  render(<LudiosSense/>);
  await waitFor(()=>expect(screen.getByText(/9,980 remaining/)).toBeInTheDocument());
  expect(screen.getByText("API usage").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText(/Saved candidates: about 2 calls/)).toBeInTheDocument();
  expect(screen.getByText(/includes other teams/)).toBeInTheDocument();
  expect(fetch.mock.calls.every((call:any)=>["/api/ludios-sense/usage","/api/ludios-sense/cache"].includes(call[0]))).toBe(true);
 });
 it("loads cached-report icons beside game names and handles broken images",async()=>{
  const game={appId:"1",store:"ios",name:"Test game",publisher:"Studio",genre:"Games, Entertainment, Games/Puzzle",classification:"included",url:"https://example.com",history:[],availableCountries:["US"],unavailableCountries:[],evaluation:{signal:"early_warning",flags:[],latest:2000,baseline:1000,growth:2,added:1000,recentAverage:2000},retrievedAt:new Date().toISOString()};
  const fetch=vi.fn(async(url:string)=>url.endsWith("/cache")?Response.json({scan:null}):url.endsWith("/icons")?Response.json({icons:{"1":"https://example.com/icon.png"},requests:1}):url.endsWith("/game")?Response.json(game):Response.json({jobKey:"sense:v1:"+"a".repeat(64),status:"completed",requests:0,progress:"Complete",result:{filters:{date:senseToday(),countries:["US"]},games:[game],generatedAt:new Date().toISOString(),watermarks:{ios:"2026-09-28"},coverageComplete:true}}));
  vi.stubGlobal("fetch",fetch);const view=render(<LudiosSense/>);
  fireEvent.click(screen.getByRole("button",{name:"Run check"}));
  await waitFor(()=>expect(view.container.querySelector('.sense-game-card img')).toHaveAttribute("src","https://example.com/icon.png"));
  expect(screen.getByRole("button",{name:"Inspect Test game, ios"})).toBeInTheDocument();

  expect(view.container.querySelector(".sense-game-card")).not.toHaveTextContent("Entertainment");
  expect(view.container.querySelector(".sense-game-card")).not.toHaveTextContent("Games/");
  fireEvent.error(view.container.querySelector('.sense-game-card img')!);
  expect(view.container.querySelector('.sense-game-card img')).toBeNull();
  expect(fetch.mock.calls.filter(([url])=>url.endsWith("/icons"))).toHaveLength(1);
 });
 it("shows a verified cross-store game once with separate metrics and selectable store reports",async()=>{
  const ios={appId:"1",store:"ios",name:"Japanese iOS title",publisher:"SEGA",genre:"Games, Entertainment, Games/Puzzle",unifiedAppId:"same",iconUrl:null,classification:"included",url:"https://example.com",history:[],availableCountries:["US"],unavailableCountries:[],evaluation:{signal:"confirmed_momentum",flags:[],latest:4395,baseline:1000,growth:4.19,added:3370,recentAverage:4395},retrievedAt:new Date().toISOString()};
  const android={...ios,appId:"pkg",store:"android",name:"Japanese Android title",genre:"Puzzle",evaluation:{...ios.evaluation,latest:2507,growth:2.43,added:1675}};
  const fetch=vi.fn(async(url:string,init:RequestInit)=>url.endsWith("/cache")?Response.json({scan:null}):url.endsWith("/game")?Response.json(JSON.parse(init.body as string).store==="android"?android:ios):Response.json({jobKey:"sense:v1:"+"a".repeat(64),status:"completed",requests:0,progress:"Complete",result:{filters:{date:senseToday(),countries:["US"]},games:[ios,android],generatedAt:new Date().toISOString(),watermarks:{ios:"2026-09-28"},coverageComplete:true}}));
  vi.stubGlobal("fetch",fetch);const view=render(<LudiosSense/>);
  fireEvent.click(screen.getByRole("button",{name:"Run check"}));
  await waitFor(()=>expect(view.container.querySelectorAll('.sense-game-card')).toHaveLength(1));
  expect(view.container.querySelector(".sense-game-card")).not.toHaveTextContent("4,395");
  expect(fetch.mock.calls.some(([url])=>url.endsWith("/game"))).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Inspect Japanese iOS title, ios"}));
  await waitFor(()=>expect(screen.getByRole("dialog")).toHaveTextContent("4,395"));
  fireEvent.click(screen.getByRole("button",{name:"View Android report for Japanese Android title"}));
  await waitFor(()=>expect(screen.getByRole("heading",{name:"Japanese Android title"})).toBeInTheDocument());
  expect(screen.getByRole("dialog")).toHaveTextContent("2,507");
  fireEvent.click(screen.getByRole("button",{name:"Close game details"}));
  fireEvent.change(screen.getByLabelText("Store"),{target:{value:"android"}});
  expect(view.container.querySelectorAll(".sense-game-card")).toHaveLength(1);
  expect(screen.getByRole("button",{name:"Inspect Japanese Android title, android"})).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url])=>url.endsWith("/icons"))).toBe(false);
 });
 it("loads another user's shared report on page open without starting a scan",async()=>{
  const scan={jobKey:"sense:v1:"+"a".repeat(64),status:"completed",cached:true,requests:92,progress:"Check complete",result:{filters:{date:senseToday(),countries:["AU","CA","DE","GB","JP","RU","US"]},games:[],generatedAt:new Date().toISOString(),watermarks:{ios:"2026-09-28"},coverageComplete:true}};
  const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith("/cache")?{scan}:{usage:{month:"2026-10",used:92,limit:10000,remaining:9908},knownHistoryCalls:0,knownMetadataCalls:0}));
  vi.stubGlobal("fetch",fetch);render(<LudiosSense/>);
  await waitFor(()=>expect(screen.getByText("Research shortlist")).toBeInTheDocument());
  fireEvent.click(screen.getByText("Report details"));
  expect(screen.getByText(/Shared saved report/)).toHaveTextContent("No new scan started");
  expect(fetch.mock.calls.every(([url])=>["/api/ludios-sense/cache","/api/ludios-sense/usage","/api/ludios-sense/recent"].includes(url))).toBe(true);
 });
 it("disables checks when every country is unchecked",()=>{
  render(<LudiosSense/>);fireEvent.click(screen.getByText(/Markets/));screen.getAllByRole("checkbox").forEach(c=>fireEvent.click(c));
  expect(screen.getByRole("button",{name:"Run check"})).toBeDisabled();
 });
 it("loads a retained game's chart from its original saved report only after inspection",async()=>{
  const sourceJobKey="sense:v1:"+"b".repeat(64),sourceGeneratedAt="2026-09-30T03:00:00Z";
  const game={appId:"missing",store:"ios",name:"Retained game",publisher:"Studio",genre:"Puzzle",classification:"included",releaseDate:null,iconUrl:null,unifiedAppId:null,url:"https://example.com",history:[],availableCountries:["US"],unavailableCountries:[],evaluation:{date:senseToday(),signal:"insufficient_data",latest:null,recentAverage:null,baseline:null,growth:null,added:null,flags:[],releaseAge:null,activityDate:null},retrievedAt:sourceGeneratedAt,watch:{firstDetected:"2026-09-29",lastDetected:"2026-09-30",referenceAverage:2000,status:"insufficient_data",sourceJobKey,sourceGeneratedAt,currentObserved:false}};
  const scan={jobKey:"sense:v1:"+"a".repeat(64),status:"completed",cached:true,requests:0,progress:"Complete",result:{filters:{date:senseToday(),countries:["AU","CA","DE","GB","JP","RU","US"]},games:[],generatedAt:new Date().toISOString(),watermarks:{ios:senseToday()},coverageComplete:true}};
  const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith("/cache")?{scan}:url.endsWith("/recent")?{games:[game]}:url.endsWith("/game")?{...game,history:[]}:{}));
  vi.stubGlobal("fetch",fetch);render(<LudiosSense/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:/Recent detections/})).toHaveTextContent("1"));
  expect(screen.queryByRole("button",{name:"Inspect Retained game, ios"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:/Recent detections/}));
  expect(fetch.mock.calls.some(([url])=>url.endsWith("/game"))).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Inspect Retained game, ios"}));
  await waitFor(()=>expect(fetch.mock.calls.some(([url])=>url.endsWith("/game"))).toBe(true));
  const request=fetch.mock.calls.find(([url])=>url.endsWith("/game"))!;
  expect(JSON.parse((request as unknown as [string,RequestInit])[1].body as string)).toEqual({jobKey:sourceJobKey,generatedAt:sourceGeneratedAt,appId:"missing",store:"ios"});
  expect(screen.getByRole("dialog")).toHaveTextContent("current downloads are unavailable");
  expect(fetch.mock.calls.some(([url])=>url.endsWith("/icons"))).toBe(false);
 });

});
