import { describe, expect, it } from "vitest";
import { requiredHistoryWeeks, mergeCountryHistory, type StoredSenseHistory } from "@/lib/ludios-sense-history";
describe("shared date-level history",()=>{
  const cached:StoredSenseHistory={histories:{US:{"2026-09-01":1,"2026-09-28":8000}},historyWindows:{US:[{start:"2026-09-01",end:"2026-09-28",at:"2026-09-30T00:00:00Z"}]}};
  it("fetches only the missing older week for a date one week back",()=>{
    expect(requiredHistoryWeeks(cached,["US"],"2026-09-21",false)).toEqual([3]);
    expect(requiredHistoryWeeks(cached,["US"],"2026-09-28",true)).toEqual([0]);
    expect(requiredHistoryWeeks(cached,["US"],"2026-09-28",false)).toEqual([]);
  });
  it("keeps future dates when merging an older query and respects omitted revisions",()=>{
    const older:StoredSenseHistory={histories:{US:{"2026-08-25":100}},historyWindows:{US:[{start:"2026-08-25",end:"2026-08-31",at:"2026-10-01T00:00:00Z"}]}};
    expect(mergeCountryHistory(cached,older,"US").histories).toEqual({"2026-09-01":1,"2026-09-28":8000,"2026-08-25":100});
    const revised:StoredSenseHistory={histories:{US:{}},historyWindows:{US:[{start:"2026-09-28",end:"2026-09-28",at:"2026-10-02T00:00:00Z"}]}};
    expect(mergeCountryHistory(cached,revised,"US").histories["2026-09-28"]).toBeUndefined();
    expect(mergeCountryHistory(revised,cached,"US").histories["2026-09-28"]).toBeUndefined();
  });
  it("treats queried missing dates as coverage but never assumes a newly selected country was queried",()=>{
    const app:StoredSenseHistory={...cached,histories:{US:{},JP:{"2026-09-28":5}}};
    expect(requiredHistoryWeeks(app,["US"],"2026-09-28",false)).toEqual([]);
    expect(requiredHistoryWeeks(app,["JP"],"2026-09-28",false)).toEqual([0,1,2,3]);
  });
});
