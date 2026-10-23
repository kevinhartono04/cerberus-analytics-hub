// @vitest-environment node
import { describe, expect, it } from "vitest";
import { convertSenseRecord } from "../scripts/migrate-sense-storage.mjs";
import { senseChartKey } from "@/lib/ludios-sense-storage";
import { requiredHistoryWeeks } from "@/lib/ludios-sense-history";
const key="sense:v1:"+"a".repeat(64);
describe("offline Sense migration",()=>{
 it("preserves observations, missing coverage and snapshot identity using the runtime format",async()=>{
  const records=new Map<string,string>();
  const history={US:{"2026-10-20":42}};
  const original={jobKey:key,stores:{android:{apps:{a:{histories:history,backfilled:true,historyStart:"2026-09-24",historyEnd:"2026-10-21"}}},ios:{apps:{}}},result:{generatedAt:"2026-10-22T00:00:00Z",games:[{appId:"a",store:"android",history:[{date:"2026-10-20",downloads:42}]}]}};
  const converted=JSON.parse(await convertSenseRecord(key,structuredClone(original),async(k:string,p:string)=>{records.set(k,p);},"2099-01-01"));
  const app=converted.stores.android.apps.a;
  expect(app.histories).toEqual({});expect(JSON.parse(records.get(app.historyRef)!)).toEqual(history);
  expect(requiredHistoryWeeks(app,["US"],"2026-10-21",false)).toEqual([]);
  expect(requiredHistoryWeeks(app,["JP"],"2026-10-21",false)).toEqual([0,1,2,3]);
  const chart=JSON.parse(records.get(senseChartKey(key,original.result.generatedAt,"android","a"))!);
  expect(chart.history).toEqual(original.result.games[0].history);
  expect(converted.result.games[0].history).toEqual([]);
 });
 it("fails before publishing a manifest if a shard cannot be written",async()=>{
  const original={stores:{android:{apps:{a:{histories:{US:{x:1}}}}}}};
  await expect(convertSenseRecord(key,original,async()=>{throw new Error("disk unavailable");},"2099-01-01")).rejects.toThrow("disk unavailable");
  expect(original.stores.android.apps.a.histories).toEqual({US:{x:1}});
 });
});
