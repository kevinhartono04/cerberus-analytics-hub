import React, { useEffect, useRef, useState } from "react";
import { AudioPreview, VideoPreview } from "./Media";
import { Empty, Icon, LibraryReferenceCard, StatusBadge, AuditDetails, FileCredit, Button, formatAuditDate, categoryKey } from "./ui";
import { downloadUrl, downloadName } from "./Library";
import { STATUSES, cueDescription } from "../model";
import {cueAudioIds,cueVideos} from "../cue-media";
import DownloadFiles from './DownloadFiles';
import ColumnResize from './ColumnResize';
import {specFiles} from '../download-files';
import {DEFAULT_WIDTHS,normalizedWidths,resizeColumn,validWidths} from '../column-widths';
export default function Viewer({ game, assets, selected, onSelect, canEdit, canStatus, editing, onEdit, onSave, onCancel, onStatus, onDuplicate, onDelete, onAdd, onEditList, editorPanel, mediaBusy=false }) {
  const [category, setCategory] = useState("All"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("All statuses");
  const columnCount=canEdit?7:6;
  const widthKey='sound-studio-column-widths-'+columnCount;
  const [widths,setWidths]=useState(null);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(widthKey));setWidths(validWidths(saved,columnCount)?saved:null);}catch{setWidths(null);}},[widthKey,columnCount]);
  function resize(index,delta=0,measured){
    setWidths(current=>{
      const next=index===null?null:resizeColumn(current || measured || normalizedWidths(DEFAULT_WIDTHS.slice(0,columnCount)),index,delta);
      try{if(next)localStorage.setItem(widthKey,JSON.stringify(next));else localStorage.removeItem(widthKey);}catch{}
      return next;
    });
  }
  const headings=['Sound ID','Category','Description/Trigger When','Audio file','Status','Notes',...(canEdit?['Cue actions']:[])];
  const [previewAsset, setPreviewAsset] = useState(null);
  const [compactLayout,setCompactLayout] = useState(()=>window.matchMedia('(max-width: 1699px)').matches);
  const [inspectorOpen,setInspectorOpen] = useState(false);
  const inspectorRef = useRef(null);
  const drawerOpen = compactLayout && (inspectorOpen || editing);
  useEffect(()=>{
    const media=window.matchMedia('(max-width: 1699px)');
    const update=()=>setCompactLayout(media.matches);
    media.addEventListener('change',update);
    return ()=>media.removeEventListener('change',update);
  },[]);
  useEffect(()=>{
    if(!drawerOpen) return;
    const previous=document.activeElement;
    inspectorRef.current?.focus();
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return ()=>{document.body.style.overflow=previousOverflow;previous?.focus();};
  },[drawerOpen]);
  function inspect(id) {onSelect(id);setInspectorOpen(true);}
  function drawerKeys(event) {
    if(!drawerOpen) return;
    if(event.key==='Escape' && !editing) {event.preventDefault();setInspectorOpen(false);}
    if(event.key!=='Tab' || !inspectorRef.current?.contains(event.target)) return;
    const controls=[...inspectorRef.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey && (event.target===first || event.target===inspectorRef.current)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && (event.target===last || event.target===inspectorRef.current)){event.preventDefault();first?.focus();}
  }

  const cue = game.cues.find((c) => c.id === selected),
    asset = assets.find((a) => a.id === cue?.assetId);
  const cats = ["All", ...new Set(game.cues.map((c) => c.category))];
  const rows = game.cues.filter(
    (c) =>
      (category === "All" || c.category === category) &&
      (status === "All statuses" || c.status === status) &&
      (c.name + " " + c.description + " " + c.trigger + " " + (c.notes || ""))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className={"viewer-layout" + (drawerOpen ? " inspector-open" : "")}>
      <section className={"spec" + (canEdit ? " has-row-actions" : "")} inert={editing || drawerOpen ? true : undefined} aria-label="Sound specs">
        <div className="spec-overview">
          <div className="spec-download-controls"><DownloadFiles files={specFiles(game,assets)} name={game.name+' - sounds'} disabled={editing}/>{widths && <Button onClick={()=>resize(null)}>Reset widths</Button>}</div>
          <div className="spec-overview-controls">
            <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
              <option>All statuses</option>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <input aria-label="Search this spec" placeholder="Search this spec" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="spec-category-bar"><div className="category-strip" role="group" aria-label="Sound categories">
          {cats.map(c => <button key={c} data-category={categoryKey(c)} aria-pressed={c===category} className={c===category?'active':''} onClick={()=>setCategory(c)}><strong>{c==='Level state'?'Level State':c || 'Uncategorized'}</strong></button>)}
        </div>
        {canEdit && <div className="actions spec-list-actions"><Button icon="edit" disabled={editing} onClick={onEditList}>Edit list</Button><Button icon="plus" kind="primary" disabled={editing} onClick={onAdd}>Add sound</Button></div>}</div>
        <div className="table-scroll">
          <table className="resizable-spec-table">
            <thead>
              <tr>
                {headings.map((heading,index)=><th key={heading} style={widths?{width:widths[index]+'%'}:undefined} className={index===6?'cue-actions-heading':''} aria-label={index===6?heading:undefined}>
                  {index!==6 && heading}{index!==6 && <ColumnResize label={heading} index={index} onResize={resize}/>}
                </th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const a = assets.find((a) => a.id === c.assetId);
                return (
                  <tr
                    key={c.id}
                    onClick={(e) => {if(!e.target.closest("button,a,input,select"))inspect(c.id);}}
                    onKeyDown={(e) => {
                      if (
                        e.target === e.currentTarget &&
                        ["Enter", " "].includes(e.key)
                      ) {
                        e.preventDefault();
                        inspect(c.id);
                      }
                    }}
                    tabIndex={0}
                    aria-label={"Inspect " + c.name}
                    aria-selected={selected === c.id}
                    className={selected === c.id ? "selected" : ""}
                  >
                    <td data-label="Sound ID">
                      <button
                        className="cue-name"
                        title={c.name}
                        onClick={() => inspect(c.id)}
                      >
                        {c.name || "Unnamed sound"}
                      </button>
                    </td>
                    <td data-label="Category"><span className="category-tag" data-category={categoryKey(c.category)}>{c.category === "Level state" ? "Level State" : c.category || "Uncategorized"}</span></td>
                    <td data-label="Description/Trigger When" className="cue-description">{cueDescription(c) || "—"}</td>
                    <td data-label="Audio file">
                      {a ? cueAudioIds(c).map(id=>assets.find(item=>item.id===id)).filter(Boolean).map(a=>(
                        <div className="table-audio-file" key={a.id}>
                          <AudioPreview
                            asset={a}
                            compact
                            onPreview={() => {
                              inspect(c.id);
                              setPreviewAsset(a.id);
                            }}
                          />
                          <span className="audio-filename" title={a.name}>
                            {a.name}
                          </span>
                          <a className="table-download" href={downloadUrl(a.audioUrl)} download={/^(\/|data:)/.test(a.audioUrl) ? downloadName(a) : undefined} target={/^(\/|data:)/.test(a.audioUrl) ? undefined : "_blank"} rel="noreferrer" onClick={e=>e.stopPropagation()} aria-label={"Download " + a.name}><Icon name="download" size={13}/>Download</a>
                        </div>
                      )) : (
                        <span className="unassigned">{c.mediaSources?.some(s=>s.type==="audio") ? "Choose audio from source folder" : c.audioReference ? c.audioReference + " · File not attached" : c.referenceUrl?.includes("/folders/") ? "Sound variations in reference folder" : "No audio uploaded"}</span>
                      )}
                    </td>
                    <td data-label="Status">
                      {canStatus ? <select title={c.status} aria-label={"Status for " + c.name} className={"status-select status-" + c.status.toLowerCase().replaceAll(" ","-")} value={c.status} onClick={e=>e.stopPropagation()} onChange={e=>onStatus(c.id,e.target.value)}>{STATUSES.map(v=><option key={v}>{v}</option>)}</select> : <StatusBadge status={c.status}/>}
                      <div className="status-credit"><AuditDetails stackedBy emptyText="" showCreated={false} updatedLabel="Updated" record={{updatedAt:c.statusHistory?.at(-1)?.at, updatedBy:c.statusHistory?.at(-1)?.by}} /></div>
                    </td>
                    <td data-label="Notes" className="cue-notes">{c.notes || "—"}</td>
                    {canEdit && <td data-label="Actions" className="cue-actions-cell"><div className="cue-row-actions">
                      <Button icon="copy" aria-label={"Duplicate " + c.name} title={"Duplicate " + c.name} disabled={editing} onClick={e => {e.stopPropagation();onDuplicate(c.id);}} />
                      <Button icon="trash" kind="danger" aria-label={"Delete " + c.name} title={"Delete " + c.name} disabled={editing} onClick={e => {e.stopPropagation();onDelete(c.id);}} />
                    </div></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty>No cues match this view.</Empty>}
      </section>
      {drawerOpen && <div className="inspector-backdrop" aria-hidden="true" onClick={()=>{if(!editing)setInspectorOpen(false);}}/>}
      <aside ref={inspectorRef} tabIndex={-1} role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen ? true : undefined} aria-label="Sound inspector" onKeyDown={drawerKeys} className={"inspector" + (editing ? " is-editing" : "")}>
        {compactLayout && !editing && <Button icon="close" className="button inspector-close" aria-label="Close sound inspector" onClick={()=>setInspectorOpen(false)}>Close</Button>}
        {editing ? <><div className="inspector-edit-actions"><div><h4>Edit sound</h4><small>Changes apply when you save.</small></div><div className="actions"><Button onClick={onCancel}>Cancel</Button><Button kind="primary" icon="save" disabled={mediaBusy} onClick={onSave}>Save</Button></div></div>{editorPanel}</> : cue ? (
          <>
            <div className="inspector-heading"><h4>Sound inspector</h4>{canEdit && <Button icon="edit" onClick={onEdit}>Edit</Button>}</div>
            <h2>{cue.name || "Unnamed sound"}</h2>
            <div className="inspector-audit" aria-label="Cue created and modified"><AuditDetails record={cue} /></div>
            <div className="inspector-status">
              <StatusBadge status={cue.status} />
            </div>
            <h4>Description/Trigger When</h4>
            <p className="cue-description">{cueDescription(cue) || "Not specified"}</p>
            <h4>Notes</h4><p className="cue-notes">{cue.notes || "No notes added."}</p>
            <h4>Audio Preview</h4>
            {asset ? cueAudioIds(cue).map(id=>assets.find(a=>a.id===id)).filter(Boolean).map(asset=>(
              <div className="inspector-attachment" key={asset.id}>
                <p className="inspector-filename">{asset.name}</p>
                <AudioPreview
                  asset={asset}
                  forceLoad={previewAsset === asset.id}
                />
                <div className="tags">
                  {asset.tags?.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <FileCredit record={asset} />
                <a
                  className="file-source"
                  href={downloadUrl(asset.audioUrl)}
                  download={/^(\/|data:)/.test(asset.audioUrl)?downloadName(asset):undefined}
                  target={/^(\/|data:)/.test(asset.audioUrl)?undefined:"_blank"}
                  rel="noreferrer"
                >
                  Download audio
                </a>
              </div>
            )) : (
              <p className="unassigned">{cue.audioReference ? cue.audioReference + " · File not attached" : "No audio uploaded for this cue."}</p>
            )}
            {cueVideos(cue).map(file=><div className="inspector-attachment" key={file.url}>
              <VideoPreview url={file.url}/><small className="inspector-video-filename">{file.name}</small><FileCredit record={file.audit}/>
              <a className="file-source" href={downloadUrl(file.url)} download={/^(\/|data:)/.test(file.url)?downloadName({videoUrl:file.url,name:file.name || 'Video'}):undefined} target={/^(\/|data:)/.test(file.url)?undefined:'_blank'} rel="noreferrer">Download video</a>
            </div>)}
            {cue.videoReference && !cue.videoUrl && <p className="unassigned">Video reference: {cue.videoReference} · File not attached</p>}
            {!!cue.mediaSources?.length && <div className="inspector-reference"><h4>Media sources</h4>{cue.mediaSources.map((source,i)=><p key={i}><a href={source.url} target="_blank" rel="noreferrer">{source.type==='audio'?'Audio':'Video'} source · {source.name}</a></p>)}</div>}
            {cue.mediaNotes && Object.entries(cue.mediaNotes).map(([type,note])=><p className="media-source-note" key={type}><strong>{type} note</strong>{note}</p>)}
            <div className="inspector-reference">
              <h4>Audio reference</h4>
              {cue.libraryReference ? <LibraryReferenceCard reference={cue.libraryReference}/> : <p className="mono">{cue.libraryReferenceId || "No library reference selected."}</p>}

            </div>
            {cue.referenceUrl && (
              <a
                className="reference-link"
                href={cue.referenceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open other reference <Icon name="external" />
              </a>
            )}
            {!!Object.keys(cue.importExtras || {}).length && <details className="status-history"><summary>Other spreadsheet fields</summary>{Object.entries(cue.importExtras).map(([key,value]) => <div key={key}><strong>{key}</strong><small>{value}</small></div>)}</details>}
            {(!!cue.statusHistory?.length || cue.statusBeforeSimplification) && <details className="status-history"><summary>Status history</summary>{cue.statusBeforeSimplification && <small>Previous status: {cue.statusBeforeSimplification}. Simplified when this demo was updated.</small>}{[...(cue.statusHistory || [])].reverse().map((change,i)=><div key={i}><strong>{change.from} → {change.to}</strong><small>Updated {formatAuditDate(change.at)} · by {change.by}</small></div>)}</details>}
          </>
        ) : (
          <Empty>Select a sound cue.</Empty>
        )}
      </aside>
    </div>
  );
}
