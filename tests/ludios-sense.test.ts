import { describe, expect, it } from "vitest";
import vectors from "@/tests/fixtures/ludios-sense-detection.json";
import { aggregateSenseHistory, classifySense, evaluateSense, shiftDate } from "@/lib/ludios-sense-detection";
import { senseRequestSchema, type SensePoint } from "@/lib/ludios-sense-types";
const t = "2026-09-28";
const history = (base: number, recent: number[]): SensePoint[] => Array.from({length:28},(_,i) => ({ date: shiftDate(t,i-27), downloads: i < 28-recent.length ? base : recent[i-(28-recent.length)] }));
describe("Ludios Sense combined detection", () => {
  it("matches the local detector on 60 reproducible baseline, gap, and short-history examples", () => {
    for (const vector of vectors) {
      const e = evaluateSense(vector.history,t,"2026-07-31");
      expect({signal:e.signal,baseline:e.baseline,latest:e.latest,recent_average:e.recentAverage,growth_multiple:e.growth,added_downloads:e.added}).toEqual(vector.expected);
    }
  });
  it.each([[10,[10,10,100],"none"],[20000,[20000,20000,20000],"none"],[500,[500,500,2000],"early_warning"],[500,[1000,1000,1000],"confirmed_momentum"],[0,[1000,1000,1000],"confirmed_momentum"]] as const)("keeps existing growth gates: %s",(base,recent,expected) => { expect(evaluateSense(history(base,[...recent]),t,null).signal).toBe(expected); });
  it("detects two-day traction independently of reported release", () => {
    expect(evaluateSense([{date:"2026-09-27",downloads:3000},{date:t,downloads:8000}],t,"2026-07-31").signal).toBe("early_warning");
  });
  it("blocks recurring weekday spikes", () => {
    const points=history(400,[]).map((p,i)=>({...p,downloads:(27-i)%7<2?1600:400}));
    expect(evaluateSense(points,t,null).signal).toBe("none");
  });
  it("sums country values into one fixed basket, preserves gaps and excludes wholly unavailable countries", () => {
    const h=aggregateSenseHistory({US:{[t]:800,[shiftDate(t,-1)]:300},JP:{[t]:500}},["US","JP","RU"],t);
    expect(h.history.at(-1)?.downloads).toBe(1300);
    expect(h.history.at(-2)?.downloads).toBeNull();
    expect(h.availableCountries).toEqual(["US","JP"]);
    expect(h.unavailableCountries).toEqual(["RU"]);
  });
  it("finds a distributed breakout below each country's individual floor", () => {
    const values=Object.fromEntries(history(200,[600,600,600]).map(p=>[p.date,p.downloads]));
    const h=aggregateSenseHistory({US:values,JP:values},["US","JP"],t);
    expect(evaluateSense(h.history,t,null).signal).toBe("confirmed_momentum");
    expect(evaluateSense(history(200,[600,600,600]),t,null).signal).toBe("none");
  });
  it("leaves metadata ambiguities in review and maps iOS category IDs", () => {
    expect(classifySense("123","ios",["6014","7012"])).toEqual({classification:"included",genre:"Games, Games/Puzzle"});
    expect(classifySense("123","ios",[]).classification).toBe("review");
  });
  it("canonicalizes country sets and rejects empty selections or invalid dates", () => {
    expect(senseRequestSchema.parse({date:t,countries:["JP","US","JP"]}).countries).toEqual(["JP","US"]);
    expect(senseRequestSchema.safeParse({date:t,countries:[]}).success).toBe(false);
    expect(senseRequestSchema.safeParse({date:"2026-02-30",countries:["US"]}).success).toBe(false);
  });
});
