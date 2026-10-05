import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SenseGameGrid, SenseMetrics, SenseScreenshots } from "@/components/LudiosSenseBrowser";
import type { SenseGame } from "@/lib/ludios-sense-types";
const game: SenseGame = {appId:"1",store:"ios",name:"Puzzle Game",publisher:"Studio",genre:"Games/Puzzle",classification:"included",iconUrl:null,unifiedAppId:null,releaseDate:null,url:"https://example.com/store",history:[],availableCountries:["US"],unavailableCountries:[],evaluation:{date:"2026-10-01",signal:"early_warning",variant:null,latest:2000,recentAverage:1800,baseline:1000,growth:2,added:1000,flags:[],activityDate:null,releaseAge:null},retrievedAt:"2026-10-01T00:00:00Z"};
afterEach(()=>vi.useRealTimers());
describe("Game browser",()=>{
 it("opens after 250 ms, keeps the interactive preview open and dismisses on Escape",()=>{
  vi.useFakeTimers();
  render(<SenseGameGrid groups={[{key:"1",members:[game]}]} icons={{}} onInspect={vi.fn()} />);
  const button=screen.getByRole("button",{name:"Inspect Puzzle Game, ios"});
  fireEvent.mouseEnter(button.parentElement!);
  act(()=>vi.advanceTimersByTime(249));expect(screen.queryByRole("region")).toBeNull();
  act(()=>vi.advanceTimersByTime(1));const preview=screen.getByRole("region",{name:"Preview Puzzle Game"});
  expect(preview).toHaveTextContent("2,000");expect(preview).toHaveTextContent("2.00×");
  fireEvent.mouseLeave(button.parentElement!,{relatedTarget:preview});fireEvent.mouseEnter(preview);
  act(()=>vi.advanceTimersByTime(500));expect(preview).toBeInTheDocument();
  fireEvent.keyDown(document,{key:"Escape"});expect(screen.queryByRole("region")).toBeNull();
 });
 it("supports keyboard focus, preview store switching, and explicit inspection",()=>{
  vi.useFakeTimers();const inspect=vi.fn();
  const android={...game,appId:"pkg",store:"android" as const,evaluation:{...game.evaluation,latest:3000}};
  render(<SenseGameGrid groups={[{key:"same",members:[game,android]}]} icons={{}} onInspect={inspect} />);
  const button=screen.getByRole("button",{name:"Inspect Puzzle Game, ios"});
  act(()=>button.focus());act(()=>vi.advanceTimersByTime(250));
  const preview=screen.getByRole("region");fireEvent.keyDown(button,{key:"Tab"});
  expect(within(preview).getByRole("button",{name:"Close preview"})).toHaveFocus();
  fireEvent.click(within(preview).getByRole("button",{name:"View Android report for Puzzle Game"}));
  expect(preview).toHaveTextContent("3,000");
  fireEvent.click(within(preview).getByRole("button",{name:"Inspect game"}));
  expect(inspect).toHaveBeenCalledWith(android);expect(screen.queryByRole("region")).toBeNull();
 });
 it("cancels a short hover and closes after leaving both card and popup",()=>{
  vi.useFakeTimers();render(<SenseGameGrid groups={[{key:"1",members:[game]}]} icons={{}} onInspect={vi.fn()} />);
  const card=screen.getByRole("button",{name:"Inspect Puzzle Game, ios"}).parentElement!;
  fireEvent.mouseEnter(card);act(()=>vi.advanceTimersByTime(100));fireEvent.mouseLeave(card);act(()=>vi.advanceTimersByTime(500));expect(screen.queryByRole("region")).toBeNull();
  fireEvent.mouseEnter(card);act(()=>vi.advanceTimersByTime(250));
  fireEvent.mouseLeave(screen.getByRole("region"));act(()=>vi.advanceTimersByTime(120));expect(screen.queryByRole("region")).toBeNull();
 });
 it("labels retained observations and never represents them as current downloads",()=>{
  render(<SenseMetrics game={{...game,watch:{firstDetected:"2026-09-29",lastDetected:"2026-09-30",referenceAverage:2000,status:"insufficient_data",sourceJobKey:"saved",sourceGeneratedAt:game.retrievedAt,currentObserved:false}}} />);
  expect(screen.getByText(/current downloads are unavailable/)).toBeInTheDocument();expect(screen.getByText("Saved latest day")).toBeInTheDocument();
 });
 it("accepts HTTPS screenshots in source order, limits to four and handles broken images",()=>{
  const urls=["http://example.com/unsafe.png",...Array.from({length:5},(_,i)=>`https://example.com/${i}.png`)];
  render(<SenseScreenshots game={{...game,screenshotUrls:urls}} />);
  expect(screen.getAllByRole("img")).toHaveLength(4);expect(screen.getAllByRole("img")[0]).toHaveAttribute("src",urls[1]);
  fireEvent.error(screen.getAllByRole("img")[0]);expect(screen.getAllByRole("img")[0]).toHaveAttribute("src",urls[2]);
 });
 it("omits absent screenshots without empty placeholders",()=>{
  const {container}=render(<SenseScreenshots game={game} />);expect(container).toBeEmptyDOMElement();
 });
});
