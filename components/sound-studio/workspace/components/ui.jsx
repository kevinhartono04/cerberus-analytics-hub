import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {cueAudioIds,cueVideos} from "../cue-media";
import { loadCatalogSnapshot } from "../library-catalog";
import { validateGameIconFile, libraryCatalog, filterLibraryCatalog, parseLibraryReference } from "../model";
const paths = {
  play: "M8 5l11 7-11 7z",
  pause: "M8 5v14M16 5v14",
  wave: "M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  edit: "m15 4 5 5M3 21l5-1L21 7l-5-5L3 15z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  folder: "M3 6h7l2 3h9v11H3z",
  link: "M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-3 3 M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l3-3",
  plus: "M12 5v14M5 12h14",
  save: "M4 3h13l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8",
  search: "M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M15 15l6 6",
  external: "M14 3h7v7M10 14 21 3 M10 3H3v18h18v-7",
  download: "M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  copy: "M8 8h13v13H8z M16 8V3H3v13h5",
  close: "m6 6 12 12M6 18 18 6",
  check: "m4 12 5 5L20 6",
  music: "M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3h3M21 16a3 3 0 1 1-3-3h3",
  upload: "M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5",
  chevron: "m7 10 5 5 5-5",
  info: "M12 8h.01M12 11v6M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20",
};
export function Icon({ name, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.wave} />
    </svg>
  );
}
export function Button({ icon, children, kind = "", ...props }) {
  return (
    <button className={"button " + kind} {...props}>
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}
export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Modal({ title, onClose, children, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("input,button")?.focus();
    return () => previous?.focus();
  }, []);
  function keys(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
    if (e.key === "Tab") {
      const items = [
        ...ref.current.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ),
      ].filter((el) => el.offsetParent !== null);
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        onKeyDown={keys}
        className={"modal " + className}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <Button icon="close" aria-label="Close dialog" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}
export function AudioSourcePicker({ references = [], assets = [], selectedReference, selectedAssetId, onChooseReference, onChooseAsset, linkValue, onLinkChange, label = "Search audio sources" }) {
  const [open,setOpen] = useState(false), [source,setSource] = useState('cerberator');
  const [query,setQuery] = useState(linkValue || ''), [preview,setPreview] = useState(null), [pasted,setPasted] = useState('');
  useEffect(()=>{if(onLinkChange)setQuery(linkValue || '');},[linkValue]);
  const linkMode = !!onLinkChange && /^[a-z][a-z0-9+.-]*:/i.test(query.trim());
  const showSearch = open && !linkMode;
  const root = useRef(null), popup = useRef(null), input = useRef(null), id = useId();
  const [position,setPosition] = useState({});
  const [snapshot,setSnapshot] = useState(null), [catalogError,setCatalogError] = useState('');
  const [loadingCatalog,setLoadingCatalog] = useState(false), [retry,setRetry] = useState(0), [limit,setLimit] = useState(50);
  useEffect(() => {
    if (!open || source !== 'cerberator' || snapshot) return;
    let active = true;
    setLoadingCatalog(true); setCatalogError('');
    loadCatalogSnapshot().then(value=>{if(active)setSnapshot(value);})
      .catch(()=>{if(active)setCatalogError('Catalog unavailable. Try loading it again.');})
      .finally(()=>{if(active)setLoadingCatalog(false);});
    return () => {active = false;};
  },[open,source,snapshot,retry]);
  const catalog = useMemo(()=>libraryCatalog([...references,selectedReference],snapshot?.sounds || []),[references,selectedReference,snapshot]);
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const files = assets.filter(a => terms.every(term => [a.name,a.sourceGame,a.category,...(a.tags || [])].join(' ').toLowerCase().includes(term)));
  const results = source === 'cerberator' ? filterLibraryCatalog(catalog,query) : files;
  let candidate = null, pasteError = '';
  if (pasted.trim()) {try {candidate=parseLibraryReference(pasted);} catch(e){pasteError=e.message;}}
  function close(returnFocus = false) {if(returnFocus) input.current?.focus(); setOpen(false); setPreview(null);}
  function changeSource(next) {setSource(next);setPreview(null);setLimit(50);}
  function choose(item) {
    if (source === 'cerberator') onChooseReference({libraryReference:item,libraryReferenceId:item.id,libraryReferenceUrl:item.metadata_url});
    else onChooseAsset(item);
    setQuery(''); close(true);
  }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = root.current.getBoundingClientRect(), gap = 6;
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const upwards = below < 300 && above > below;
      const width = Math.min(500,window.innerWidth-24);
      setPosition({width,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),
        ...(upwards ? {bottom:window.innerHeight-rect.top+gap} : {top:rect.bottom+gap}),
        maxHeight:Math.max(150,Math.min(480,(upwards ? above : below)-gap))});
    };
    place(); window.addEventListener('resize',place); window.addEventListener('scroll',place,true);
    const outside = e => {if(!root.current?.contains(e.target) && !popup.current?.contains(e.target)) {setOpen(false);setPreview(null);}};
    document.addEventListener('pointerdown',outside); document.addEventListener('focusin',outside);
    return () => {window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};
  },[open]);
  function keys(e) {
    if(e.key === 'Escape') {e.preventDefault();e.stopPropagation();close(true);}
    if(e.target === input.current && e.key === 'Enter') e.preventDefault();
    if(['ArrowDown','ArrowUp'].includes(e.key) && (e.target === input.current || e.target.hasAttribute('data-pick-result'))) {
      e.preventDefault();setOpen(true);
      const items = [...(popup.current?.querySelectorAll('[data-pick-result]') || [])];
      const index = items.indexOf(e.target);
      items[index < 0 ? (e.key === 'ArrowUp' ? items.length-1 : 0) : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length)%items.length]?.focus();
    }
  }
  return <div className="audio-source-picker" ref={root} onKeyDown={keys}>
    <div className="audio-source-search"><Icon name="search" size={15}/><input ref={input} aria-label={label} aria-haspopup="dialog" aria-expanded={showSearch} aria-controls={showSearch ? id : undefined} placeholder={onLinkChange ? "Paste link or search…" : "Search library or uploaded files…"} value={query} onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);if(onLinkChange && (!e.target.value || /^[a-z][a-z0-9+.-]*:/i.test(e.target.value.trim())))onLinkChange(e.target.value.trim());setOpen(true);setPreview(null);setLimit(50);}}/><Icon name="chevron" size={14}/></div>
    {showSearch && createPortal(<section ref={popup} id={id} className="audio-source-dropdown" role="dialog" aria-label="Choose audio source" style={position} onKeyDown={keys}>
      <div className="audio-source-tabs" role="group" aria-label="Audio sources">
        <button type="button" aria-pressed={source==='cerberator'} onClick={()=>changeSource('cerberator')}>Cerberator Library <span>{loadingCatalog ? '…' : catalog.length.toLocaleString()}</span></button>
        <button type="button" aria-pressed={source==='uploads'} onClick={()=>changeSource('uploads')}>Uploaded Files <span>{assets.length}</span></button>
        <button type="button" className="audio-source-close" aria-label="Close audio search" onClick={()=>close(true)}><Icon name="close" size={14}/></button>
      </div>
      <p className="audio-source-note">{source==='cerberator' ? snapshot ? `Exported catalog · Imported ${snapshot.importedOn} · Not live synced` : 'Use as a reference' : 'Attach to this cue · Audio files only'}</p>
      {source==='cerberator' && loadingCatalog && <p className="audio-source-note" role="status">Loading exported catalog…</p>}
      {source==='cerberator' && catalogError && <div className="audio-source-load-error" role="alert">{catalogError}<Button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</Button></div>}
      <div className="audio-source-results" aria-label="Audio search results">
        {!results.length && !(source==='cerberator' && loadingCatalog) && <p className="audio-source-empty">{query ? 'No matches. Try another name, tag, category or game.' : source==='uploads' ? 'No uploaded audio files yet.' : 'No library sounds available.'}</p>}
        {results.slice(0,limit).map(item => {
          const name = source==='cerberator' ? item.title : item.name;
          const chosen = source==='cerberator' ? item.id===selectedReference?.id : item.id===selectedAssetId;
          return <div className="audio-source-result" key={item.id}>
            <button type="button" data-pick-result aria-label={`${source==='cerberator'?'Use reference':'Attach'} ${name}`} className="audio-source-option" onClick={()=>choose(item)}>
              <strong>{name}{chosen && <Icon name="check" size={14}/>}</strong>
              <small>{[item.game || item.sourceGame,item.category].filter(Boolean).join(' · ')}</small>
            </button>
            <button type="button" className="audio-source-preview-button" aria-label={`Preview ${name}`} aria-pressed={preview?.id===item.id} onClick={()=>setPreview(preview?.id===item.id ? null : item)}><Icon name="play" size={14}/></button>
          </div>;
        })}
      </div>
      {!!results.length && <div className="audio-source-result-count"><small>{Math.min(limit,results.length).toLocaleString()} of {results.length.toLocaleString()} matches</small>{results.length>limit && <button type="button" onClick={()=>setLimit(value=>value+50)}>Show more</button>}</div>}
      {preview && <AudioSourcePreview key={source+preview.id} item={preview} library={source==='cerberator'}/>}
      {source==='cerberator' && <details className="audio-source-paste"><summary>Add from Copy for AI</summary><textarea aria-label="Copy for AI content" rows={3} value={pasted} maxLength={100000} onChange={e=>setPasted(e.target.value)} placeholder="Paste Cerberator sound details"/>{pasteError && <small role="alert">{pasteError}</small>}<Button type="button" disabled={!candidate} onClick={()=>{choose(candidate);setPasted('');}}>Use reference</Button></details>}
    </section>,root.current?.closest(".sound-studio") || document.body)}
  </div>;
}
function AudioSourcePreview({ item, library }) {
  const [failed,setFailed] = useState(false);
  const url = library ? item.preview_url || item.audio_url : item.audioUrl;
  const drive = url?.match(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/);
  return <div className="audio-source-preview"><strong>{item.title || item.name}</strong>
    {drive ? <iframe title={`Preview ${item.name}`} src={`https://drive.google.com/file/d/${drive[1]}/preview`} allow="autoplay"/> : url ? <audio aria-label="Audio source preview" controls autoPlay preload="none" src={url} onError={()=>setFailed(true)} onPlay={e=>document.querySelectorAll('audio,video').forEach(a=>{if(a!==e.target)a.pause();})}/> : <small>No playable file available.</small>}
    {failed && <small role="status">Preview unavailable. The source may require access. You can still select it.</small>}
  </div>;
}
export function LibraryReferenceCard({ reference }) {
  const [failed, setFailed] = useState(false);
  const preview = reference.preview_url || reference.audio_url;
  useEffect(() => setFailed(false), [preview]);
  const duration = reference.duration_sec;
  const durationText = duration == null ? '' : duration < 1 ? `${duration.toFixed(2)}s` : `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2,'0')}`;
  return <section className="library-reference-card" aria-label="Selected library sound">
    <strong>{reference.title}</strong>
    <small>{[reference.game, reference.category, durationText].filter(Boolean).join(' · ')}</small>
    <small className="mono">{reference.id}</small>
    {reference.tags.length > 0 && <div className="tags">{reference.tags.map(tag=><span key={tag.id}>{tag.id.replace(/^[^.]+\./,'').replaceAll('_',' ')}</span>)}</div>}
    {preview ? <><audio key={preview} aria-label="Library reference audio preview" controls preload="none" src={preview} onError={()=>setFailed(true)}/>{failed && <small role="status">Preview unavailable with this session. You can still use this reference.</small>}</> : <small>No preview URL included. You can still save this reference.</small>}
  </section>;
}
export function Empty({ children }) {
  return (
    <div className="empty">
      <Icon name="wave" size={26} />
      <p>{children}</p>
    </div>
  );
}

export function StatusBadge({ status }) {
  return (
    <span
      className={"status status-" + status.toLowerCase().replaceAll(" ", "-")}
    >
      {status}
    </span>
  );
}

export const formatAuditDate = (value) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Unknown";

export function AuditDetails({ record = {}, emptyText = "Original timestamps unavailable for this imported sample.", createdLabel = "Created", updatedLabel = "Modified", stackedBy = false, showCreated = true, showMissing = showCreated }) {
  const entries = [
    ...(showCreated ? [[createdLabel, record.createdAt, record.createdBy]] : []),
    [updatedLabel, record.updatedAt, record.updatedBy],
  ].filter(([, at, by]) => showMissing || at || by);
  if (!entries.length) return emptyText ? <small className="audit-unavailable">{emptyText}</small> : null;
  return <dl className="record-audit">
    {entries.map(([label, at, by]) => <div key={label}>
      <dt>{label}{" "}</dt><dd>
        {at ? <time dateTime={at}>{formatAuditDate(at)}</time> : "Date/time Unknown"}
        <span className={stackedBy ? "audit-by-line" : undefined}>{stackedBy ? "by " : " · by "}{by || "Unknown"}</span>
      </dd>
    </div>)}
  </dl>;
}

export function FileCredit({ record }) {
  return <div className="file-credit">
    <AuditDetails record={record} createdLabel="Added" updatedLabel="Updated" emptyText="Original file timestamps unavailable." />
  </div>;
}

export function GamePicker({ games, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null),
    trigger = useRef(null);
  const current = games.find((g) => g.id === selectedId) || games[0];
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    root.current?.querySelector('[aria-checked="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function keys(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
      return;
    e.preventDefault();
    const items = [...root.current.querySelectorAll('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  }
  return (
    <div
      className="game-picker"
      ref={root}
      onKeyDown={keys}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <h1>
        <button
          ref={trigger}
          className="game-title-button"
          aria-label={"Select game: " + current.name}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls="saved-game-menu"
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (!open && ["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          {current.name}
          <span className={open ? "chevron-open" : ""}>
            <Icon name="chevron" size={18} />
          </span>
        </button>
      </h1>
      {open && (
        <div
          className="game-menu"
          role="menu"
          aria-label="Saved game specs"
          id="saved-game-menu"
        >
          <h4>Saved game specs</h4>
          {games.map((g) => (
            <button
              key={g.id}
              role="menuitemradio"
              aria-checked={g.id === selectedId}
              onClick={() => {
                onSelect(g.id);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <strong>{g.name}</strong>
              <small>
                {g.cues.length} sound cues ·{" "}
                {new Set(g.cues.flatMap(cueAudioIds)).size}{" "}
                audio files ·{" "}
                {new Set(g.cues.flatMap(c=>cueVideos(c).map(v=>v.url))).size}{" "}
                videos
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const categoryKey = (category = "") => category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function GameIconUpload({label = 'Add icon', ariaLabel = label, disabled = false, onChange, onBusyChange}) {
  const [reading,setReading] = useState(false), [error,setError] = useState('');
  const latestChange = useRef(onChange); latestChange.current = onChange;
  return <div className="game-icon-upload">
    <label className={'button icon-upload-button' + (disabled || reading ? ' is-disabled' : '')}>
      <Icon name="upload"/>{reading ? 'Reading…' : label}
      <input type="file" aria-label={ariaLabel} accept=".png,.jpg,.jpeg,.webp" disabled={disabled || reading} onChange={async event => {
        const file=event.target.files?.[0]; event.target.value=''; if (!file) return;
        setError(''); setReading(true); onBusyChange?.(true);
        try {
          validateGameIconFile(file);
          const type=/\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg';
          const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read this image.'));reader.readAsDataURL(new Blob([file],{type}));});
          await new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(Error('This file could not be opened as an image.'));image.src=url;});
          await latestChange.current(url);
        } catch(e) {setError(e.message);} finally {setReading(false);onBusyChange?.(false);}
      }}/>
    </label>
    {error && <small role="alert" className="new-field-error">{error}</small>}
  </div>;
}
