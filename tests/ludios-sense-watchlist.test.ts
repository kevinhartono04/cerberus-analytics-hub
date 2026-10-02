import { describe, expect, it } from "vitest";
import { buildSenseWatchlist } from "@/lib/ludios-sense-watchlist";
import type { SenseGame, SenseRunResponse } from "@/lib/ludios-sense-types";
const game = (date: string, signal: SenseGame["evaluation"]["signal"], average = 99090, latest = 85438): SenseGame => ({appId:"rings",store:"ios",name:"Rotate Rings",publisher:"Studio",genre:"Puzzle",classification:"included",releaseDate:null,url:"https://example.com",history:[],availableCountries:["US"],unavailableCountries:[],retrievedAt:date,evaluation:{date,signal,variant:null,latest,recentAverage:average,baseline:null,growth:null,added:null,flags:[],activityDate:null,releaseAge:null}});
const report = (date: string, games: SenseGame[]): SenseRunResponse => ({jobKey:`sense:v1:${date}`,status:"completed",requests:0,progress:"Complete",result:{filters:{date,countries:["US"]},generatedAt:date,watermarks:{ios:date},games,errors:[],requests:0,coverageComplete:true,ruleVersion:"1.4-aggregate"}});
describe("saved detection watchlist",()=>{
 it("keeps Rotate Rings holding scale after its rolling growth signal expires",()=>{
  const current=report("2026-09-30",[game("2026-09-30","none",90133,86722)]);
  const [entry]=buildSenseWatchlist(current,[report("2026-09-29",[game("2026-09-29","confirmed_momentum")])]);
  expect(entry.evaluation.signal).toBe("none");
  expect(entry.evaluation.latest).toBe(86722);
  expect(entry.watch).toMatchObject({status:"holding_scale",firstDetected:"2026-09-29",referenceAverage:99090,sourceJobKey:current.jobKey});
 });
 it("distinguishes cooling volume from missing current observations",()=>{
  const detected=report("2026-09-29",[game("2026-09-29","early_warning")]);
  expect(buildSenseWatchlist(report("2026-09-30",[game("2026-09-30","none",70000,80000)]),[detected])[0].watch?.status).toBe("cooling_down");
  const missing=buildSenseWatchlist(report("2026-09-30",[]),[detected])[0];
  expect(missing.watch).toMatchObject({status:"insufficient_data",currentObserved:false,sourceJobKey:detected.jobKey});
  expect(missing.evaluation.latest).toBeNull();
 });
 it("retains seven inclusive reporting days and excludes future and different-country reports",()=>{
  const current=report("2026-09-30",[]);
  expect(buildSenseWatchlist(current,[report("2026-09-24",[game("2026-09-24","early_warning")])])).toHaveLength(1);
  expect(buildSenseWatchlist(current,[report("2026-09-23",[game("2026-09-23","early_warning")])])).toHaveLength(0);
  const other=report("2026-09-29",[game("2026-09-29","early_warning")]);other.result!.filters.countries=["JP"];
  expect(buildSenseWatchlist(current,[other,report("2026-10-01",[game("2026-10-01","early_warning")])])).toHaveLength(0);
 });
 it("deduplicates saved reports and keeps the latest detection reference",()=>{
  const earlier=report("2026-09-28",[game("2026-09-28","early_warning",60000)]);
  const latest=report("2026-09-29",[game("2026-09-29","confirmed_momentum",100000)]);
  const current=report("2026-09-30",[game("2026-09-30","none",75000)]);
  const entries=buildSenseWatchlist(current,[latest,earlier,latest]);
  expect(entries).toHaveLength(1);
  expect(entries[0].watch).toMatchObject({firstDetected:"2026-09-28",lastDetected:"2026-09-29",referenceAverage:100000,status:"cooling_down"});
 });
});
