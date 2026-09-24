"use client";

import React, { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, Copy, Headphones, Loader2, Search, X } from "lucide-react";
import CerberusShell from "@/components/CerberusShell";
import type { Assessment } from "@/lib/refund-review/model";

type Result = { status: "completed"; assessment: Assessment; botSections: string[]; checkDetails?: string; checkedAt: string };
type Selection = { status: "selection_required"; message: string; matchingIds: string[]; candidates: {id: string; product: string; at: string; amountUsd: number | null; transactionId: string}[] };
type Access = { authenticated: boolean; access?: { accountType: string } | null };
const inputStyle = "mt-2 w-full rounded-xl border border-line bg-surface-panel px-3.5 py-3 text-sm text-ink outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20 disabled:opacity-60";
const dateLabel = (s: string | null) => s ? new Date(s).toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC" : "No events";
function MessageText({ text }: { text: string }) {
  // Render the bot's limited Slack markup as text nodes; never interpret source HTML.
  return <div className="whitespace-pre-wrap break-words text-sm leading-7">{text.split(/(\*[^*\n]+\*)/g).map((part, i) => part.startsWith("*") && part.endsWith("*") ? <strong key={i} className="font-semibold text-ink">{part.slice(1, -1)}</strong> : <React.Fragment key={i}>{part.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")}</React.Fragment>)}</div>;
}
async function post(url: string, body: unknown, signal: AbortSignal) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "The check failed. Please try again.");
  return value;
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 2000);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
export default function CsAssistance() {
  const [access, setAccess] = useState<Access | null>(null);
  const [accessError, setAccessError] = useState(false);
  const [idfv, setIdfv] = useState("");
  const [dispute, setDispute] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const queryToken = useRef("");
  const [asOf, setAsOf] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [checkedInput, setCheckedInput] = useState<{ idfv: string; asOf: string } | null>(null);
  const [tab, setTab] = useState<"response" | "evidence" | "logic">("response");
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/me", { signal: abort.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(setAccess).catch(() => { if (!abort.signal.aborted) setAccessError(true); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  const canCheck = access?.authenticated && access.access?.accountType === "internal";
  const normalized = idfv.replaceAll("-", "").trim().toLowerCase();
  const validId = /^(?:[a-f\d]{32}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.test(idfv.trim());
  const today = new Date().toISOString().slice(0, 10);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validId || !dispute || !canCheck || loading) return;
    controller.current?.abort();
    const run = new AbortController(); controller.current = run;
    setLoading(true); setSelection(null); setResult(null); setError(""); setCopied(false); setTab("response");
    setCheckedInput({ idfv: normalized, asOf });
    try {
      const started = await post("/api/cs-assistance", { idfv: normalized, asOf, dispute, purchaseDate, amountUsd }, run.signal);
      queryToken.current = started.token;
      while (!run.signal.aborted) {
        if (Date.now() >= started.expiresAt) throw new Error("This check timed out after ten minutes. Please run it again.");
        const next = await post("/api/cs-assistance/status", { token: started.token }, run.signal);
        if (next.status === "selection_required") { if (!run.signal.aborted) setSelection(next); break; }
        if (next.status === "completed") { if (!run.signal.aborted) setResult(next); break; }
        await pause(run.signal);
      }
    } catch (err) {
      if (!run.signal.aborted) setError(err instanceof Error ? err.message : "The check failed. Please try again.");
    } finally { if (controller.current === run) setLoading(false); }
  }
  async function choose(selectedId: string) {
    controller.current?.abort();
    const run = new AbortController(); controller.current = run;
    setLoading(true); setError("");
    try {
      const next = await post("/api/cs-assistance/status", { token: queryToken.current, selectedId }, run.signal);
      if (!run.signal.aborted) { if (next.status !== "completed") throw new Error("The check is not ready. Try selecting the purchase again."); setResult(next); setSelection(null); }
    } catch (err) { if (!run.signal.aborted) setError(err instanceof Error ? err.message : "Could not select purchase."); }
    finally { if (controller.current === run) setLoading(false); }
  }
  function cancel() { controller.current?.abort(); setLoading(false); setError("Stopped waiting. You can start a new check."); }
  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.botSections.join("\n\n")); setCopied(true); }
    catch { setError("Could not copy. You can select and copy the response below."); }
  }
  const observed = result?.assessment.trace.observed;
  const counts = result?.assessment.findings.reduce((acc, f) => { acc[f.verdict] = (acc[f.verdict] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  return <CerberusShell currentProduct="cs-assistance">
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-subtle"><Headphones size={17} className="text-cobalt" /> Player support <span className="text-line">/</span> Stack Smash</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink md:text-4xl">CS Assistance</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-text-subtle">Review a player’s purchase and ad history. See the refund recommendation, the bot’s wording, and the evidence behind it.</p>
      </div><span className="rounded-full border border-emerald/25 bg-emerald/10 px-3 py-1.5 text-xs font-semibold text-emerald">Live event lookup</span>
    </header>
    <div className="grid items-start gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-line bg-surface-card p-5">
        <h2 className="text-base font-semibold text-ink">Check a player</h2>
        <p className="mt-2 text-xs leading-5 text-text-subtle">Stack Smash · Last 90 days through your selected review date.</p>
        {accessError ? <p role="alert" className="mt-4 text-sm text-rose">Could not verify your access. Refresh this page.</p> : !access ? <p className="mt-4 text-sm text-text-subtle">Checking your access…</p> : !access.authenticated ? <a href="/api/auth/signin?callbackUrl=%2Fcs-assistance" className="mt-4 block text-sm font-semibold text-cobalt underline">Sign in to use CS Assistance</a> : !canCheck ? <p role="alert" className="mt-4 text-sm text-rose">CS Assistance is available to internal team members.</p> : null}
        <form onSubmit={submit} className="mt-6 space-y-5">
          <div><label htmlFor="cs-idfv" className="text-sm font-medium text-ink">Player IDFV</label>
            <input id="cs-idfv" name="idfv" value={idfv} onChange={e => setIdfv(e.target.value)} placeholder="Paste the player’s IDFV" autoComplete="off" spellCheck={false} required disabled={loading || !canCheck} className={`${inputStyle} font-mono text-xs`} aria-describedby="idfv-help" />
            <p id="idfv-help" className={`mt-2 text-xs ${idfv && !validId ? "text-rose" : "text-text-subtle"}`}>{idfv && !validId ? "Enter 32 hexadecimal characters, with optional hyphens." : "Hyphenated and compact IDs are accepted."}</p>
          </div>
          <div><label htmlFor="cs-dispute" className="text-sm font-medium text-ink">Dispute type</label>
            <select id="cs-dispute" value={dispute} onChange={e => setDispute(e.target.value)} required disabled={loading || !canCheck} className={inputStyle}><option value="">Select the issue</option><option value="items">Items / coins not received</option><option value="no_ads">No ads not working</option></select>
          </div>
          <div><label htmlFor="cs-purchase-date" className="text-sm font-medium text-ink">Purchase date (optional, UTC)</label><input id="cs-purchase-date" type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} max={asOf || today} disabled={loading || !canCheck} className={inputStyle} /></div>
          <div><label htmlFor="cs-amount" className="text-sm font-medium text-ink">Purchase amount (USD, optional)</label><input id="cs-amount" type="number" min="0.01" max="100000" step="0.01" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} placeholder="14.99" disabled={loading || !canCheck} className={inputStyle} /><p className="mt-2 text-xs text-text-subtle">Matches the USD amount recorded in the purchase event.</p></div>
          <div><label htmlFor="cs-date" className="text-sm font-medium text-ink">Ticket date <span className="font-normal text-text-subtle">(optional)</span></label>
            <input type="date" id="cs-date" value={asOf} onChange={e => setAsOf(e.target.value)} max={today} disabled={loading || !canCheck} className={inputStyle} />
            <p className="mt-2 text-xs leading-5 text-text-subtle">Leave blank to check through now. Earlier dates include the full day in UTC and exclude later events.</p>
          </div>
          <button type="submit" disabled={!validId || !dispute || !canCheck || loading || (!!asOf && asOf > today)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cobalt px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">{loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}{loading ? "Checking history…" : "Check player"}</button>
          {loading ? <button type="button" onClick={cancel} className="flex w-full items-center justify-center gap-2 text-xs text-text-subtle"><X size={14} /> Stop waiting</button> : <button type="button" disabled={!canCheck} onClick={() => { setIdfv("38645146fe0ea5644f7853ee3d88f77e"); setAsOf("2026-09-08"); setDispute("no_ads"); setPurchaseDate("2026-08-19"); setAmountUsd("14.99"); }} className="flex w-full items-center justify-center gap-2 text-xs font-medium text-cobalt disabled:opacity-40">Use the VIP Pass example <ArrowRight size={13} /></button>}
        </form>
        <p className="mt-6 border-t border-line pt-4 text-xs leading-5 text-text-subtle">Results appear here for your review. This check does not send a Slack message or issue a refund.</p>
      </aside>
      <section className="min-w-0" aria-label="Review results">
        {error ? <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-rose/30 bg-rose/5 p-4 text-sm text-rose"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div> : null}
        {loading ? <div role="status" className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-line bg-surface-card p-8 text-center"><Loader2 size={28} className="animate-spin text-cobalt" /><h2 className="mt-5 text-lg font-semibold text-ink">Reading purchase and ad history</h2><p className="mt-2 max-w-sm text-sm leading-6 text-text-subtle">This can take a few minutes. Your results will appear automatically when the query finishes.</p></div> : selection ? <div className="rounded-2xl border border-line bg-surface-card p-5"><h2 className="text-lg font-semibold text-ink">Select the disputed purchase</h2><p className="my-4 text-sm text-text-subtle">{selection.message}</p><div className="space-y-3">{selection.candidates.map(p => <button type="button" key={p.id} onClick={() => choose(p.id)} className="block w-full rounded-xl border border-line p-4 text-left text-sm text-ink hover:border-cobalt"><strong>{p.product} · {p.amountUsd === null ? "USD amount unavailable" : `$${p.amountUsd.toFixed(2)}`}</strong><p>{dateLabel(p.at)}</p><p className="break-all text-xs text-text-subtle">Transaction: {p.transactionId}</p><p className="mt-1 text-xs text-text-subtle">{selection.matchingIds.includes(p.id) ? "Matches supplied inputs" : "Does not match all supplied inputs — confirm before selecting"}</p></button>)}</div></div> : result ? <>
          <div className="mb-5 rounded-2xl border border-line bg-surface-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wider text-text-subtle">Review complete</p><h2 className="mt-1 text-xl font-semibold text-ink">{result.assessment.findings.length} purchase{result.assessment.findings.length === 1 ? "" : "s"} found</h2></div><span className="text-xs text-text-subtle">{observed?.meta.eventCount.toLocaleString() ?? "—"} events reviewed</span></div>
            <p className="mt-3 break-all font-mono text-xs text-text-subtle">IDFV {checkedInput?.idfv}</p><p className="mt-1 text-xs text-text-subtle">Through {dateLabel(result.assessment.trace.coverage.through)}</p>
            <div className="mt-4 flex flex-wrap gap-2">{Object.entries(counts ?? {}).map(([name, count]) => <span key={name} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${name === "Needs review" ? "border-amber/30 bg-amber/10 text-amber" : "border-line bg-surface-panel text-ink"}`}>{count} · {name}</span>)}</div>
          </div>
          <div className="mb-4 flex flex-wrap gap-2 border-b border-line pb-3" role="tablist" aria-label="Result views">{([["response", "Bot response"], ["evidence", "Evidence"], ["logic", "Checking logic"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} id={`tab-${id}`} onClick={() => setTab(id)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === id ? "bg-cobalt/10 text-cobalt" : "text-text-subtle hover:bg-surface-panel"}`}>{label}</button>)}</div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="rounded-2xl border border-line bg-surface-card p-5 md:p-6">
            {tab === "response" ? <><div className="mb-5 flex items-center justify-between gap-3"><span className="text-xs text-text-subtle">Current bot wording · CS makes the final decision</span><button type="button" onClick={copy} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy response"}</button></div><div className="divide-y divide-line text-text-subtle">{result.botSections.map((text, i) => <div key={i} className="py-4 first:pt-0 last:pb-0">{i === 1 ? <div className="rounded-xl border border-cobalt/20 bg-cobalt/5 p-4"><MessageText text={text} /></div> : <MessageText text={text} />}</div>)}</div><div className="mt-5 space-y-3 border-t border-line pt-4"><details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm font-medium text-ink">View evidence</summary><div className="mt-3 space-y-4 text-sm leading-6 text-text-subtle">{result.assessment.findings.map((f,i) => <div key={i}><p className="font-medium text-ink">{f.product}</p><p className="break-all text-xs">Transaction: {f.transactionId}</p><p className="text-xs">Purchased: {dateLabel(f.purchasedAt)}</p><ul className="mt-2 list-disc space-y-1 pl-4">{f.details?.map((d,n) => <li key={n}>{d}</li>)}</ul></div>)}<button type="button" onClick={() => setTab("evidence")} className="font-medium text-cobalt">Open full event evidence</button></div></details><details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm font-medium text-ink">View check details</summary><div className="mt-3 text-text-subtle"><MessageText text={result.checkDetails ?? result.assessment.trace.coverage.limitations.join("; ")} /></div></details></div></> : null}
            {tab === "evidence" ? <div className="space-y-7">
              <div><h3 className="font-semibold text-ink">Purchase evidence</h3>{result.assessment.findings.map((f, i) => <details key={i} className="mt-3 rounded-xl border border-line p-4" open={i === 0}><summary className="cursor-pointer text-sm font-medium text-ink">{f.product} · {dateLabel(f.purchasedAt)}</summary><ul className="mt-3 space-y-2 text-sm leading-6 text-text-subtle">{f.details?.map((d, n) => <li key={n} className="break-words">{d}</li>)}</ul></details>)}</div>
              <div><h3 className="mb-3 font-semibold text-ink">Daily activity and ads</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-text-subtle"><tr>{["Date (UTC)", "Events", "Interstitial", "Rewarded"].map(h => <th key={h} className="px-2 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{observed?.daily.map(d => <tr key={d.day} className="border-b border-line/50 text-ink"><td className="whitespace-nowrap px-2 py-2.5">{d.day}</td><td className="px-2 py-2.5">{d.events.toLocaleString()}</td><td className="px-2 py-2.5">{d.interstitials}</td><td className="px-2 py-2.5">{d.rewarded}</td></tr>)}</tbody></table></div></div>
              <div><h3 className="mb-3 font-semibold text-ink">Nearby coins and items</h3><p className="mb-3 text-xs leading-5 text-text-subtle">Within ±2 minutes of each purchase in the same session. These movements are associated by time; they are not confirmed transaction links.</p>{!observed?.resources.length ? <p className="text-sm text-text-subtle">No nearby movements found.</p> : <ul className="space-y-2 text-sm text-text-subtle">{observed.resources.map((r, i) => <li key={i} className="rounded-lg bg-surface-panel p-3"><span className="font-medium text-ink">{r.direction === "received" ? "+" : "−"}{r.amount.toLocaleString()} {r.item}</span><p className="mt-1 text-xs">{dateLabel(r.firstAt)} · {r.source} · Product {observed.purchases.find(p => p.id === r.purchaseId)?.productId ?? "unknown"}</p></li>)}</ul>}</div>
            </div> : null}
            {tab === "logic" ? <div className="space-y-5 text-sm leading-7 text-text-subtle"><h3 className="text-lg font-semibold text-ink">How this recommendation is made</h3><p><strong className="text-ink">Temporary no-ads.</strong> Matches the product catalog, looks for interstitials before purchase, observed play without interstitials, then returning interstitials. Two active dates, at least 48 elapsed hours and rewarded-ad activity are minimum evidence checks. They are not the season duration. Expiry is an inference unless an explicit expiry record is available.</p><p><strong className="text-ink">Permanent no-ads.</strong> Rewarded ads are not covered. Interstitials after purchase flag a possible entitlement issue for review.</p><p><strong className="text-ink">Coins and items.</strong> Positive amounts are receipts; negative amounts are spending. Nearby credits do not prove every item was delivered without package quantities and transaction links.</p><h4 className="font-semibold text-ink">Limits of this check</h4><ul className="list-disc space-y-2 pl-5">{result.assessment.trace.coverage.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul><p>Reinstalls can produce multiple user IDs under the same IDFV; their activity is reviewed together. Unknown products, conflicting purchases, incomplete query results and uncertain evidence require manual review.</p></div> : null}
          </div>
        </> : <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-card/50 p-8 text-center"><div className="rounded-2xl border border-line bg-surface-card p-4"><Headphones size={30} className="text-cobalt" /></div><h2 className="mt-5 text-xl font-semibold text-ink">Start with a player’s IDFV</h2><p className="mt-3 max-w-md text-sm leading-6 text-text-subtle">Choose the dispute type. Date and USD amount help locate the purchase; if the match is unclear, you will select it before receiving a recommendation.</p><div className="mt-7 flex flex-wrap justify-center gap-3 text-xs text-text-subtle">{["Purchase matching", "Ad history", "Coin & item movements"].map(s => <span key={s} className="rounded-full border border-line px-3 py-2">{s}</span>)}</div></div>}
      </section>
    </div>
  </CerberusShell>;
}
