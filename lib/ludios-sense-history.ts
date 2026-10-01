import type { SenseCountry } from "@/lib/ludios-sense-types";
import { shiftDate } from "@/lib/ludios-sense-detection";
export type HistoryWindow = {start:string;end:string;at:string};
export type StoredSenseHistory = {
  histories: Partial<Record<SenseCountry,Record<string,number|null>>>;
  historyWindows?: Partial<Record<SenseCountry,HistoryWindow[]>>;
  countryHistory?: Partial<Record<SenseCountry,HistoryWindow>>;
  backfilled?:boolean; historyStart?:string;historyEnd?:string;historyAt?:string;
};
export function historyWindows(app: StoredSenseHistory, country: SenseCountry): HistoryWindow[] {
  if (app.historyWindows?.[country]) return app.historyWindows[country]!;
  const legacy = app.countryHistory?.[country] ?? (app.countryHistory === undefined && app.backfilled && app.histories[country] !== undefined && app.historyStart && app.historyEnd ? {start:app.historyStart,end:app.historyEnd,at:app.historyAt ?? ""} : null);
  return legacy ? [legacy] : [];
}
export function requiredHistoryWeeks(app: StoredSenseHistory, countries: SenseCountry[], t:string, refreshRecent=true) {
  return [0,1,2,3].filter(week => {
    const end=shiftDate(t,-7*week),start=shiftDate(end,-6);
    // Refresh revisions only in the real recent reporting window, not every historical selection.
    if (refreshRecent && week===0) return true;
    return countries.some(country=>Array.from({length:7},(_,i)=>shiftDate(start,i)).some(date=>!historyWindows(app,country).some(w=>w.start<=date && w.end>=date)));
  });
}
export function mergeHistoryWindows(windows:HistoryWindow[]):HistoryWindow[] {
  const days = new Map<string,string>();
  for(const window of windows) for(let d=window.start;d<=window.end;d=shiftDate(d,1)) if(!days.has(d) || days.get(d)!<window.at) days.set(d,window.at);
  const result:HistoryWindow[]=[];
  for(const [date,at] of [...days].sort(([a],[b])=>a.localeCompare(b))) {
    const last=result.at(-1);
    if(last && last.at===at && shiftDate(last.end,1)===date) last.end=date;
    else result.push({start:date,end:date,at});
  }
  return result;
}
/** Merge overlapping queries by retrieval time; an omitted revised value remains missing. */
export function mergeCountryHistory(left:StoredSenseHistory,right:StoredSenseHistory,country:SenseCountry) {
  const histories={...left.histories[country]};
  const old=historyWindows(left,country),next=historyWindows(right,country);
  for(const w of next) for(let date=w.start;date<=w.end;date=shiftDate(date,1)) {
    const previous=old.filter(v=>v.start<=date && v.end>=date).map(v=>v.at).sort().at(-1);
    if(previous===undefined || previous<=w.at) {
      const value=right.histories[country]?.[date];
      if(value===undefined) delete histories[date]; else histories[date]=value;
    }
  }
  // Preserve legacy observations without coverage, but do not let them overwrite queried revisions.
  for(const [date,value] of Object.entries(right.histories[country] ?? {})) if(!(date in histories) && !old.some(w=>w.start<=date && w.end>=date) && !next.some(w=>w.start<=date && w.end>=date)) histories[date]=value;
  const windows=mergeHistoryWindows([...old,...next]);
  const end=windows.at(-1)?.end;
  if(end) {
    const cutoff=shiftDate(end,-117);
    for(const date of Object.keys(histories)) if(date<cutoff) delete histories[date];
    return {histories,windows:windows.filter(w=>w.end>=cutoff).map(w=>({...w,start:w.start<cutoff?cutoff:w.start}))};
  }
  return {histories,windows};
}
