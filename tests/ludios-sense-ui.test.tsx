import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LudiosSense from "@/components/LudiosSense";
vi.mock("@/components/CerberusShell",()=>({default:({children}:{children:React.ReactNode})=><main>{children}</main>}));
beforeEach(()=>{sessionStorage.clear();vi.unstubAllGlobals();});
describe("Sense page",()=>{
 it("defaults to today and seven selected markets, sends unchecked selection, and renders the completed report",async()=>{
  const fetch=vi.fn(async(_url:string,init:RequestInit)=>{const filters=JSON.parse(init.body as string);return Response.json({jobKey:"sense:v1:"+"a".repeat(64),status:"completed",requests:12,progress:"Check complete",result:{filters:{...filters,countries:[...filters.countries].sort()},games:[],generatedAt:new Date().toISOString(),watermarks:{ios:"2026-09-28",android:"2026-09-28"},coverageComplete:true,errors:[],ruleVersion:"1.4-aggregate",requests:12}});});
  vi.stubGlobal("fetch",fetch);render(<LudiosSense/>);
  expect(screen.getByLabelText("Date (t)")).toHaveValue(new Date().toISOString().slice(0,10));
  expect(screen.getAllByRole("checkbox")).toHaveLength(7);screen.getAllByRole("checkbox").forEach(c=>expect(c).toBeChecked());
  fireEvent.click(screen.getByRole("checkbox",{name:"Japan"}));fireEvent.click(screen.getByRole("button",{name:"Run check"}));
  await waitFor(()=>expect(screen.getByText("Research shortlist")).toBeInTheDocument());
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).countries).not.toContain("JP");
  expect(screen.getByText(/Requested t:/)).toHaveTextContent("2026-09-28");
 });
 it("shows the monthly allowance and saved-candidate estimate without running a scan",async()=>{
  const fetch=vi.fn(async()=>Response.json({usage:{month:"2026-10",used:20,limit:10000,remaining:9980,trackingStartedAt:"2026-10-01T03:00:00Z",organizationUsed:200,organizationLimit:10000,organizationObservedAt:"2026-10-01T03:00:00Z"},knownGames:200,knownHistoryCalls:2,knownMetadataCalls:0,note:"Discovery and new games add calls"}));vi.stubGlobal("fetch",fetch);
  render(<LudiosSense/>);
  await waitFor(()=>expect(screen.getByText(/9,980 remaining/)).toBeInTheDocument());
  expect(screen.getByText("API usage").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText(/Saved candidates: about 2 calls/)).toBeInTheDocument();
  expect(screen.getByText(/includes other teams/)).toBeInTheDocument();
  expect(fetch.mock.calls.every((call:any)=>call[0]==="/api/ludios-sense/usage")).toBe(true);
 });
 it("loads cached-report icons beside game names and handles broken images",async()=>{
  const game={appId:"1",store:"ios",name:"Test game",publisher:"Studio",genre:"Games, Entertainment, Games/Puzzle",classification:"included",url:"https://example.com",history:[],availableCountries:["US"],unavailableCountries:[],evaluation:{signal:"early_warning",flags:[],latest:2000,baseline:1000,growth:2,added:1000,recentAverage:2000},retrievedAt:new Date().toISOString()};
  const fetch=vi.fn(async(url:string)=>url.endsWith("/icons")?Response.json({icons:{"1":"https://example.com/icon.png"},requests:1}):url.endsWith("/game")?Response.json(game):Response.json({jobKey:"sense:v1:"+"a".repeat(64),status:"completed",requests:0,progress:"Complete",result:{filters:{date:new Date().toISOString().slice(0,10),countries:["US"]},games:[game],generatedAt:new Date().toISOString(),watermarks:{ios:"2026-09-28"},coverageComplete:true}}));
  vi.stubGlobal("fetch",fetch);const view=render(<LudiosSense/>);
  fireEvent.click(screen.getByRole("button",{name:"Run check"}));
  await waitFor(()=>expect(view.container.querySelector('td img')).toHaveAttribute("src","https://example.com/icon.png"));
  expect(screen.getByRole("button",{name:"Inspect Test game, ios"})).toBeInTheDocument();
  expect(view.container.querySelector("td")).toHaveTextContent("Puzzle");
  expect(view.container.querySelector("td")).not.toHaveTextContent("Entertainment");
  expect(view.container.querySelector("td")).not.toHaveTextContent("Games/");
  fireEvent.error(view.container.querySelector('td img')!);
  expect(view.container.querySelector('td img')).toBeNull();
  expect(fetch.mock.calls.filter(([url])=>url.endsWith("/icons"))).toHaveLength(1);
 });
 it("shows a verified cross-store game once with separate metrics and selectable store reports",async()=>{
  const ios={appId:"1",store:"ios",name:"Japanese iOS title",publisher:"SEGA",genre:"Games, Entertainment, Games/Puzzle",unifiedAppId:"same",iconUrl:null,classification:"included",url:"https://example.com",history:[],availableCountries:["US"],unavailableCountries:[],evaluation:{signal:"confirmed_momentum",flags:[],latest:4395,baseline:1000,growth:4.19,added:3370,recentAverage:4395},retrievedAt:new Date().toISOString()};
  const android={...ios,appId:"pkg",store:"android",name:"Japanese Android title",genre:"Puzzle",evaluation:{...ios.evaluation,latest:2507,growth:2.43,added:1675}};
  const fetch=vi.fn(async(url:string,init:RequestInit)=>url.endsWith("/game")?Response.json(JSON.parse(init.body as string).store==="android"?android:ios):Response.json({jobKey:"sense:v1:"+"a".repeat(64),status:"completed",requests:0,progress:"Complete",result:{filters:{date:new Date().toISOString().slice(0,10),countries:["US"]},games:[ios,android],generatedAt:new Date().toISOString(),watermarks:{ios:"2026-09-28"},coverageComplete:true}}));
  vi.stubGlobal("fetch",fetch);const view=render(<LudiosSense/>);
  fireEvent.click(screen.getByRole("button",{name:"Run check"}));
  await waitFor(()=>expect(view.container.querySelector('td[rowspan="2"]')).toBeInTheDocument());
  expect(view.container.querySelector("table")).toHaveTextContent("4,395");expect(view.container.querySelector("table")).toHaveTextContent("2,507");
  expect(view.container.querySelectorAll("table tbody")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:"View Android report for Japanese Android title"}));
  await waitFor(()=>expect(screen.getByRole("heading",{name:"Japanese Android title"})).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Store"),{target:{value:"android"}});
  expect(view.container.querySelectorAll("table tbody tr")).toHaveLength(1);
  expect(view.container.querySelector("table")).not.toHaveTextContent("4,395");
  expect(fetch.mock.calls.some(([url])=>url.endsWith("/icons"))).toBe(false);
 });
 it("disables checks when every country is unchecked",()=>{
  render(<LudiosSense/>);screen.getAllByRole("checkbox").forEach(c=>fireEvent.click(c));
  expect(screen.getByRole("button",{name:"Run check"})).toBeDisabled();
 });
});
