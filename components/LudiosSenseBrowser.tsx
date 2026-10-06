"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ArrowUpRight, Gamepad2, X } from "lucide-react";
import { sensePreviewPosition } from "@/lib/ludios-sense-preview";
import type { SenseGame } from "@/lib/ludios-sense-types";
import { senseTableGenres, type groupSenseGames } from "@/lib/ludios-sense-presentation";

type GameGroup = ReturnType<typeof groupSenseGames>[number];
export const senseNumber = (value: number | null) => value === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
export const senseGrowth = (game: SenseGame) => game.evaluation.baseline === 0 ? "From zero" : game.evaluation.growth === null ? "—" : `${game.evaluation.growth.toFixed(2)}×`;
export function senseStatus(game: SenseGame) {
  if (game.watch && game.watch.status !== "current_signal") return ({ holding_scale: "Holding scale", cooling_down: "Cooling down", insufficient_data: "Insufficient data" })[game.watch.status];
  return ({ confirmed_momentum: "Confirmed momentum", early_warning: "Early warning", launch_traction: "Traction, unconfirmed", insufficient_data: "Insufficient data", none: "No current signal" })[game.evaluation.signal];
}
export function SenseStatus({ game, compact=false }: { game: SenseGame; compact?: boolean }) {
  const label = senseStatus(game);
  const color = ({"Confirmed momentum":"text-emerald","Early warning":"text-amber","Holding scale":"text-cobalt","Cooling down":"text-orange-500","Traction, unconfirmed":"text-sky-500","Insufficient data":"text-slate-500","No current signal":"text-slate-400"})[label];
  const hollow = label === "Insufficient data" || label === "No current signal";
  if (compact) return <span role="img" aria-label={label} title={label} className={`sense-status-dot inline-flex h-5 w-5 items-center justify-center ${color}`}><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${hollow ? `border border-current ${label === "Insufficient data" ? "border-dashed" : ""}` : "bg-current"}`} /></span>;
  return <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-table px-2.5 py-1 text-[10px] font-semibold ${color}`}><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{label}</span>;
}
function SenseStoreIcon({ store }: { store: SenseGame["store"] }) {
  const label = store === "ios" ? "iOS" : "Android";
  return <svg role="img" aria-label={label} viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><title>{label}</title>{store === "ios" ? <><path d="M15.7 2.2c.1 1.3-.4 2.5-1.2 3.3-.8.8-1.9 1.3-3 1.2-.1-1.2.4-2.4 1.2-3.2.8-.8 2-1.3 3-1.3Z" /><path d="M19.9 17.4c-.4.9-.7 1.4-1.2 2.2-.8 1.1-1.9 2.5-3.2 2.5-1.2 0-1.5-.8-3.2-.8s-2 .8-3.2.8c-1.3 0-2.4-1.3-3.2-2.4C3.7 16.5 3 12.3 4.4 9.8c1-1.8 2.6-2.8 4.2-2.8 1.3 0 2.2.8 3.2.8 1 0 2.4-1 4-1 1.4 0 2.8.7 3.6 1.8-3.1 1.7-2.6 6.1.5 7.4Z" /></> : <><path d="m6.7 7.6-1.4-2.4.8-.5 1.5 2.5a9 9 0 0 1 8.8 0l1.5-2.5.8.5-1.4 2.4A7 7 0 0 1 20 13H4a7 7 0 0 1 2.7-5.4ZM4 14h16v5a1 1 0 0 1-1 1h-2v2h-2v-2H9v2H7v-2H5a1 1 0 0 1-1-1v-5ZM1 14h2v5H1v-5Zm20 0h2v5h-2v-5Z" /><circle cx="8" cy="10" r="1" className="fill-surface-card" /><circle cx="16" cy="10" r="1" className="fill-surface-card" /></>}</svg>;
}
function GameArtwork({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState(false);
  return <span className="sense-game-art flex aspect-square w-full items-center justify-center overflow-hidden max-w-[112px] rounded-2xl border border-line/50 bg-surface-table shadow-sm">
    {url && !failed ? <Image unoptimized src={url} alt="" width={112} height={112} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" onError={() => setFailed(true)} /> : <Gamepad2 aria-hidden="true" className="h-8 w-8 text-slate-400" />}
  </span>;
}
export function SenseScreenshots({ game }: { game: SenseGame }) {
  const [failed, setFailed] = useState<string[]>([]);
  const urls = (game.screenshotUrls ?? []).filter(url => {
    try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.searchParams.has("auth_token") && !failed.includes(url); } catch { return false; }
  }).slice(0,4);
  return urls.length ? <div aria-label="Store screenshots" className="mb-4 flex gap-2 overflow-x-auto rounded-xl bg-surface-table p-2">{urls.map((url,index) => <Image unoptimized key={url} src={url} alt={`${game.name} store screenshot ${index+1}`} width={180} height={320} referrerPolicy="no-referrer" className="h-44 w-auto max-w-none rounded-lg object-contain" onError={() => setFailed(old => [...old,url])} />)}</div> : null;
}
export function SenseMetrics({ game }: { game: SenseGame }) {
  const old = game.watch?.currentObserved === false;
  return <>
    {old ? <p className="mb-3 rounded-lg bg-amber/10 p-2 text-xs text-amber">Not evaluated in this report. These are saved observations from {game.watch!.lastDetected}; current downloads are unavailable.</p> : null}
    <dl className="grid grid-cols-3 gap-3 rounded-xl border border-line/60 bg-surface-table p-3">
      {[[old ? "Saved latest day" : "Latest day",senseNumber(game.evaluation.latest)],["Growth",senseGrowth(game)],["Added / day",game.evaluation.added === null ? "—" : `${game.evaluation.added < 0 ? "" : "+"}${senseNumber(game.evaluation.added)}`]].map(([label,value]) => <div key={label}><dt className="text-[10px] text-slate-500">{label}</dt><dd className="mt-1 font-mono text-sm font-semibold text-ink">{value}</dd></div>)}
    </dl>
    {game.watch ? <p className="mt-3 text-[11px] text-slate-500">Detected {game.watch.firstDetected} · Last signal {game.watch.lastDetected}</p> : null}
  </>;
}
export function SenseStoreTabs({ members, selected, onSelect }: { members: SenseGame[]; selected: SenseGame; onSelect: (game: SenseGame) => void }) {
  return <div className="flex gap-2" aria-label="Store reports">{members.map(game => <button key={`${game.store}:${game.appId}`} aria-pressed={game.store === selected.store && game.appId === selected.appId} aria-label={`View ${game.store === "ios" ? "iOS" : "Android"} report for ${game.name}`} onClick={() => onSelect(game)} className={`focus-ring rounded-lg border px-3 py-1.5 text-xs font-semibold ${game.store === selected.store && game.appId === selected.appId ? "border-cobalt/30 bg-cobalt/10 text-cobalt" : "border-line/70 text-slate-500"}`}>{game.store === "ios" ? "iOS" : "Android"}</button>)}</div>;
}
function GameCard({ group, icons, onInspect }: { group: GameGroup; icons: Record<string,string|null>; onInspect: (game: SenseGame) => void }) {
  const game = group.members[0];
  const [preview, setPreview] = useState(false);
  const [storeGame, setStoreGame] = useState(game);
  const [position, setPosition] = useState({ left: 0, top: 0, width:420,maxHeight:460 });
  const card = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissed = useRef(false);
  const pointerSuppressed = useRef(false);
  const suppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const clearTimers = () => { if (openTimer.current) clearTimeout(openTimer.current); if (closeTimer.current) clearTimeout(closeTimer.current); };
  const close = () => { clearTimers(); setPreview(false); };
  const schedule = () => {
    if (dismissed.current) return;
    clearTimers();
    openTimer.current = setTimeout(() => {
      const rect = card.current?.querySelector(".sense-game-art")?.getBoundingClientRect();
      if (!rect) return;
      setPosition(sensePreviewPosition(rect,{width:window.innerWidth,height:window.innerHeight}));
      document.dispatchEvent(new CustomEvent("sense-preview-open", { detail: id }));
      setStoreGame(group.members[0]); setPreview(true);
    },250);
  };
  const leave = (target: EventTarget | null) => {
    if (target instanceof Node && (card.current?.contains(target) || popup.current?.contains(target))) return;
    clearTimers(); closeTimer.current = setTimeout(() => setPreview(false),120);
  };
  useEffect(() => () => { if (openTimer.current) clearTimeout(openTimer.current); if (closeTimer.current) clearTimeout(closeTimer.current); },[]);
  useEffect(() => {
    const dismissOthers = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) { clearTimers(); setPreview(false); } };
    // Removal of an overlay can send mouseenter to the card underneath it.
    const suppressPointer = () => {
      pointerSuppressed.current = true;
      if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
      suppressionTimer.current = setTimeout(() => { pointerSuppressed.current = false; },350);
    };
    document.addEventListener("sense-preview-open",dismissOthers);
    document.addEventListener("sense-preview-suppress",suppressPointer);
    return () => {
      document.removeEventListener("sense-preview-open",dismissOthers);
      document.removeEventListener("sense-preview-suppress",suppressPointer);
      if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
    };
  },[id]);
  useEffect(() => {
    if (!preview) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); dismissed.current = true; document.dispatchEvent(new Event("sense-preview-suppress")); clearTimers(); setPreview(false); if (popup.current?.contains(document.activeElement)) card.current?.querySelector("button")?.focus(); } };
    const reposition = (event: Event) => { if (event.target instanceof Node && popup.current?.contains(event.target)) return; setPreview(false); };
    document.addEventListener("keydown",dismiss);
    window.addEventListener("scroll",reposition,true);
    window.addEventListener("resize",reposition);
    return () => { document.removeEventListener("keydown",dismiss); window.removeEventListener("scroll",reposition,true); window.removeEventListener("resize",reposition); };
  },[preview]);
  return <div ref={card} className="sense-game-card relative min-w-0" onMouseEnter={() => { if (pointerSuppressed.current) return; dismissed.current = false; schedule(); }} onMouseLeave={event => leave(event.relatedTarget)} onFocus={event => { if (!event.currentTarget.contains(event.relatedTarget)) { if (!popup.current?.contains(event.relatedTarget)) dismissed.current = false; schedule(); } }} onBlur={event => leave(event.relatedTarget)}>
    <button aria-label={`Inspect ${game.name}, ${game.store}`} aria-expanded={preview} aria-controls={preview ? id : undefined} onKeyDown={event => { if (event.key === "Tab" && !event.shiftKey && preview) { event.preventDefault(); popup.current?.querySelector("button")?.focus(); } }} onClick={() => { close(); onInspect(game); }} className="focus-ring group block w-full rounded-2xl text-left">
      <GameArtwork key={game.iconUrl ?? icons[`${game.store}:${game.appId}`] ?? "missing"} url={game.iconUrl ?? icons[`${game.store}:${game.appId}`]} />
      <span className="mt-2 block truncate text-xs font-bold text-ink">{game.name}</span>
      <span className="mt-0.5 block truncate text-[11px] text-slate-500">{game.publisher || "Publisher unavailable"}</span>
      <span className="mt-1.5 flex max-w-[112px] items-center gap-2 text-slate-500">{group.members.map(g => <SenseStoreIcon key={g.store} store={g.store} />)}<span className="ml-auto"><SenseStatus game={game} compact /></span></span>
    </button>
    {preview ? createPortal(<div ref={popup} id={id} role="region" aria-label={`Preview ${game.name}`} style={{left:position.left,top:position.top,width:position.width,maxHeight:position.maxHeight}} className="fixed z-40 overflow-y-auto rounded-2xl border border-line bg-surface-card p-5 text-ink shadow-2xl" onMouseEnter={clearTimers} onMouseLeave={event => leave(event.relatedTarget)} onFocus={clearTimers} onBlur={event => leave(event.relatedTarget)}>
      <div className="mb-3 flex items-start justify-between gap-2"><div><h3 className="text-base font-bold">{storeGame.name}</h3><p className="mt-1 text-xs text-slate-500">{storeGame.publisher}</p></div><button aria-label="Close preview" onKeyDown={event => { if (event.key === "Tab" && event.shiftKey) { event.preventDefault(); card.current?.querySelector("button")?.focus(); } }} onClick={() => { dismissed.current = true; document.dispatchEvent(new Event("sense-preview-suppress")); close(); card.current?.querySelector("button")?.focus(); }} className="focus-ring rounded-lg p-1 text-slate-500"><X aria-hidden="true" className="h-4 w-4" /></button></div>
      <div className="mb-3"><SenseStoreTabs members={group.members} selected={storeGame} onSelect={setStoreGame} /></div>
      <SenseScreenshots key={`${storeGame.store}:${storeGame.appId}`} game={storeGame} />
      <div className="mb-3"><SenseStatus game={storeGame} /></div><SenseMetrics game={storeGame} />
      <p className="mt-3 text-xs text-slate-500">{senseTableGenres([storeGame])}</p>
      <div className="mt-4 flex items-center justify-between gap-3"><button className="focus-ring rounded-lg bg-cobalt px-3 py-2 text-xs font-bold text-white" onClick={() => { close(); onInspect(storeGame); }}>Inspect game</button><a href={storeGame.url} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-cobalt">Open store listing <ArrowUpRight aria-hidden="true" className="h-3 w-3" /></a></div>
    </div>,document.body) : null}
  </div>;
}
export function SenseGameGrid({ groups, icons, onInspect }: { groups: GameGroup[]; icons: Record<string,string|null>; onInspect: (game: SenseGame) => void }) {
  return <div className="sense-game-grid grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-5">{groups.map(group => <GameCard key={group.key} group={group} icons={icons} onInspect={onInspect} />)}</div>;
}
export function SenseDetailDrawer({ game, members, onSelect, onClose, children }: { game: SenseGame; members: SenseGame[]; onSelect: (game: SenseGame) => void; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const title = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.dispatchEvent(new CustomEvent("sense-preview-open", { detail: "drawer" }));
    element?.showModal(); closeButton.current?.focus(); document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previousOverflow; previous?.focus(); };
  },[]);
  return createPortal(<dialog ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }} className="sense-detail-drawer fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-l border-line bg-surface-card p-5 text-ink shadow-2xl backdrop:bg-black/35 sm:w-[min(760px,90vw)] sm:p-7">
    <div className="mb-5 flex items-start justify-between gap-4"><div><p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-cobalt">Game research</p><h2 id={title} className="font-display text-2xl font-bold">{game.name}</h2><p className="mt-1 text-xs text-slate-500">{game.publisher} · {game.genre}</p></div><button ref={closeButton} aria-label="Close game details" onClick={onClose} className="focus-ring rounded-lg border border-line p-2"><X aria-hidden="true" className="h-5 w-5" /></button></div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><SenseStoreTabs members={members} selected={game} onSelect={onSelect} /><a href={game.url} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-cobalt">Open store listing <ArrowUpRight aria-hidden="true" className="h-3 w-3" /></a></div>
    <SenseScreenshots key={`${game.store}:${game.appId}`} game={game} /><div className="mb-3"><SenseStatus game={game} /></div><SenseMetrics game={game} />
    <div className="mt-5">{children}</div>
  </dialog>,document.body);
}
