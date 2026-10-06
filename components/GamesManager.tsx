"use client";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Check, Gamepad2, Plus, Search, X } from "lucide-react";
import CerberusShell from "@/components/CerberusShell";
import type { GameSummary } from "@/lib/game-catalog";

const emptyDraft = { name: "", appId: "", bundleId: "", adjustAndroid: "", adjustIos: "" };
const inputClass = "focus-ring mt-2 h-11 w-full rounded-xl border border-line/70 bg-surface-panel px-3 text-sm text-ink placeholder:text-slate-500";
export default function GamesManager() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/games", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load games");
      if (!cancelled) { setGames(data.games); setCanManage(data.canManage); }
    }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, appId: Number(draft.appId) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add game");
      setGames(current => [...current, data.game].sort((a, b) => a.name.localeCompare(b.name)));
      setSuccess(`${data.game.name} is ready to select in all dashboards.`); setDraft(emptyDraft); setShowForm(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not add game"); }
    finally { setSaving(false); }
  }
  const visible = games.filter(game => `${game.name} ${game.appId} ${game.bundleId}`.toLowerCase().includes(search.toLowerCase()));
  return <CerberusShell currentProduct="admin" activeAdminSection="games" contentClassName="max-w-[1200px]">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-cobalt">Admin · Game setup</p><h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">Games Setting</h1><p className="mt-2 max-w-xl text-sm text-slate-500">Add a game once. Find it across Launch Signal and Signal QA.</p></div>{canManage ? <button type="button" onClick={() => { setShowForm(true); setError(""); setSuccess(""); }} className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-cobalt px-5 text-sm font-bold text-white"><Plus className="h-4 w-4" />Add game</button> : null}</header>
    {success ? <div role="status" className="mb-5 flex items-center gap-3 rounded-xl border border-emerald/30 bg-emerald/10 p-4 text-sm text-ink"><Check className="h-4 w-4 text-emerald" />{success}<a href="/tech-launch" className="ml-auto inline-flex items-center gap-1 font-semibold text-cobalt">Open Launch Signal<ArrowRight className="h-4 w-4" /></a></div> : null}
    {error ? <p role="alert" className="mb-5 rounded-xl border border-rose/30 bg-rose/10 p-4 text-sm text-rose">{error}</p> : null}
    {showForm ? <section aria-labelledby="add-game-heading" className="mb-6 rounded-2xl border border-cobalt/30 bg-surface-card p-6 shadow-soft"><div className="mb-6 flex items-start justify-between gap-4"><div><h2 id="add-game-heading" className="font-display text-xl font-bold text-ink">Add a new game</h2><p className="mt-1 text-sm text-slate-500">App details are required. Adjust app tokens are optional.</p></div><button type="button" disabled={saving} aria-label="Close add game" onClick={() => { setShowForm(false); setError(""); }} className="focus-ring rounded-lg p-2 text-slate-500"><X className="h-5 w-5" /></button></div><form onSubmit={save}>
      <div className="grid gap-5 md:grid-cols-2"><label className="text-sm font-semibold text-ink">Game name<input autoFocus required maxLength={80} pattern="[a-z][a-z0-9_-]*" placeholder="ringtangle" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value.toLowerCase().replace(/\s/g, "") })} className={inputClass} /><span className="mt-2 block text-xs font-normal text-slate-500">Lowercase game key used in dashboard filters.</span></label><label className="text-sm font-semibold text-ink">App ID<input required type="number" min={1} max={2147483647} step={1} placeholder="3015" value={draft.appId} onChange={event => setDraft({ ...draft, appId: event.target.value })} className={inputClass} /><span className="mt-2 block text-xs font-normal text-slate-500">The app_id used in telemetry.</span></label><label className="text-sm font-semibold text-ink md:col-span-2">Bundle ID<input required maxLength={255} placeholder="com.puzzlegames.idlematch" value={draft.bundleId} onChange={event => setDraft({ ...draft, bundleId: event.target.value })} className={inputClass} /></label></div>
      <div className="my-6 border-t border-line/70" /><h3 className="text-sm font-bold text-ink">Adjust integration</h3><p className="mt-1 text-xs text-slate-500">Use platform app tokens. The workspace API credential is managed separately.</p><div className="mt-4 grid gap-5 md:grid-cols-2">{([['adjustAndroid', 'Android app token'], ['adjustIos', 'iOS app token']] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold text-ink">{label}<input type="password" autoComplete="off" maxLength={128} placeholder="Optional" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} className={inputClass} /></label>)}</div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-surface-panel p-4"><p className="max-w-lg text-xs text-slate-500">Saving makes this game available in all dashboard filters. Data appears when telemetry is available. Partner access and automated alerts are configured separately.</p><button disabled={saving} type="submit" className="focus-ring h-10 rounded-lg bg-cobalt px-5 text-sm font-bold text-white disabled:opacity-50">{saving ? "Adding…" : "Add to dashboards"}</button></div>
    </form></section> : null}
    <section className="overflow-hidden rounded-2xl border border-line/70 bg-surface-card shadow-soft"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-line/70 p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-cobalt/10 p-2.5"><Gamepad2 className="h-5 w-5 text-cobalt" /></div><div><h2 className="font-display font-bold text-ink">Game registry</h2><p className="mt-0.5 text-xs text-slate-500">{loading ? "Loading games…" : `${games.length} games in your workspace`}</p></div></div><label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input aria-label="Search games" placeholder="Search name, ID or bundle" value={search} onChange={event => setSearch(event.target.value)} className="focus-ring h-10 w-64 max-w-full rounded-lg border border-line/70 bg-surface-panel pl-9 pr-3 text-sm text-ink" /></label></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-panel font-mono text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Game</th><th className="px-5 py-3">App ID</th><th className="px-5 py-3">Bundle ID</th><th className="px-5 py-3">Adjust Android</th><th className="px-5 py-3">Adjust iOS</th></tr></thead><tbody>{visible.map(game => <tr key={game.name} className="border-t border-line/50"><td className="px-5 py-4 font-semibold text-ink">{game.name}</td><td className="px-5 py-4 font-mono text-xs text-slate-500">{game.appId}</td><td className="px-5 py-4 font-mono text-xs text-slate-500">{game.bundleId || "—"}</td><td className="px-5 py-4 text-xs text-slate-500">{game.adjustAndroidConfigured ? "Configured" : "Not configured"}</td><td className="px-5 py-4 text-xs text-slate-500">{game.adjustIosConfigured ? "Configured" : "Not configured"}</td></tr>)}</tbody></table></div>{!loading && !visible.length ? <p className="p-8 text-center text-sm text-slate-500">No games match your search.</p> : null}
    </section>
  </CerberusShell>;
}
