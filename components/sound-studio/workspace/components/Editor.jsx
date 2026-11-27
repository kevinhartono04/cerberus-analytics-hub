import React, { useState, useRef } from "react";
import { CATEGORIES, STATUSES, cueDescription } from "../model";
import { Button, Field, Empty, Icon, StatusBadge, FileCredit, AudioSourcePicker, LibraryReferenceCard } from "./ui";
import Library from "./Library";
import { repository } from "../adapters/repository";
import { AudioPreview, VideoPreview } from "./Media";
import MediaAttachments from "./MediaAttachments";
import {cueAudioIds,cueVideos,setCueAudio,setCueVideos} from "../cue-media";
export default function Editor({
  game,
  assets,
  selected,
  onSelect,
  onChange,
  onAddAsset,
  onMediaChange,
  onBusyChange=()=>{},
  compact = false,
  videos = [],
  referenceCatalog = [],
}) {
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  const cue = game.cues.find((c) => c.id === selected);
  const cueRef=useRef(cue);cueRef.current=cue;
  const audioAsset = assets.find(a => a.id === cue?.assetId);
  const pendingMedia=useRef(new Set());
  function mediaBusy(type,value){if(value)pendingMedia.current.add(type);else pendingMedia.current.delete(type);onBusyChange(pendingMedia.current.size>0);}
  function changeFiles(type,files){
    const cue=cueRef.current;
    if(type==='video'){onChange(setCueVideos(cue,files));return;}
    const added=[];
    const ids=files.map(file=>{
      const existing=assets.find(a=>a.id===file.assetId || a.audioUrl===file.url) || added.find(a=>a.audioUrl===file.url);
      if(existing)return existing.id;
      const asset={id:crypto.randomUUID(),name:file.name || cue.name,audioUrl:file.url,category:cue.category,tags:[],sourceGame:game.name,libraryId:'',libraryUrl:'',origin:'upload'};
      added.push(asset);return asset.id;
    });
    onMediaChange(setCueAudio(cue,ids),added);
  }
  const patch = (k, v) => onChange({ ...cue, [k]: v, ...(['libraryReferenceId','libraryReferenceUrl'].includes(k) ? {libraryReference:null} : {}) });
  return (
    <div
      className={"editor-layout" + (compact ? " inspector-editor" : "")}
      aria-busy={uploading}
      inert={uploading ? true : undefined}
    >
      {!compact && <aside className="cue-list">
        <div className="cue-search">
          <Icon name="search" />
          <input
            aria-label="Search sound cues"
            placeholder="Search sound cues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span>{game.cues.length}</span>
        </div>
        {game.cues
          .filter((c) =>
            (c.name + " " + cueDescription(c))
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((c) => (
            <button
              className={"cue-card " + (c.id === selected ? "selected" : "")}
              onClick={() => onSelect(c.id)}
              key={c.id}
            >
              <div>
                <strong>{c.name}</strong>
                <StatusBadge status={c.status} />
              </div>
              <small>{c.category || "Uncategorized"}</small>
              <p>{cueDescription(c) || "Add a description"}</p>
            </button>
          ))}
      </aside>}
      {cue ? (
        <article className="editor-details">
          {!compact && <div className="details-title"><div><h4>Sound cue details</h4><h2>{cue.name || "Untitled cue"}</h2></div></div>}
          <div className="form-row">
            <Field label="Sound ID">
              <input
                value={cue.name}
                onChange={(e) => patch("name", e.target.value)}
              />
            </Field>
            <Field label="Category">
              <select
                value={cue.category}
                onChange={(e) => patch("category", e.target.value)}
              >
                <option value="">Choose Option</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c === "Level state" ? "Level State" : c}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                className={"status-select status-" + cue.status.toLowerCase().replaceAll(" ", "-")}
                value={cue.status}
                onChange={(e) => patch("status", e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Description/Trigger When (optional)">
            <textarea aria-label="Description/Trigger When (optional)" rows="3"
              value={cueDescription(cue)}
              onChange={e => onChange({...cue, description:e.target.value, trigger:''})}/>
          </Field>
          <Field label="Notes (optional)"><textarea aria-label="Notes (optional)" rows="2" value={cue.notes || ''} onChange={e=>patch('notes',e.target.value)}/></Field>
          {['audio','video'].map(type=><section key={cue.id+type} className={'editor-media-card editor-'+type+'-card'} aria-label={type+' attachments'}>
            <header className="editor-media-heading"><h3>{type==='audio'?'Audio Preview':'Video Preview'} {type==='video' && <span>Optional</span>}</h3><p>Attach one or more files for this cue.</p></header>
            <MediaAttachments type={type} label={type+' for '+cue.name}
              files={type==='audio'?cueAudioIds(cue).map(id=>{const a=assets.find(a=>a.id===id);return {assetId:id,url:a?.audioUrl || '',name:a?.name || ''};}):cueVideos(cue)}
              onChange={files=>changeFiles(type,files)} assets={assets} references={referenceCatalog} reference={cue.libraryReference}
              onReference={values=>onChange({...cue,...values})} sources={cue.mediaSources || []} onSourcesChange={mediaSources=>onChange({...cue,mediaSources})}
              note={cue.mediaNotes?.[type]} onBusyChange={value=>mediaBusy(type,value)}/>
            {type==='video' && !!videos.length && <Field label="Choose from Uploaded Files"><select value="" onChange={e=>{const v=videos.find(v=>v.videoUrl===e.target.value);if(v)onChange(setCueVideos(cue,[...cueVideos(cue),{url:v.videoUrl,name:v.name,audit:v}]));}}><option value="">Choose a video</option>{videos.map(v=><option key={v.id} value={v.videoUrl}>{v.name}</option>)}</select></Field>}
          </section>)}
          <section className="editor-media-card editor-reference-card" aria-label="Sound references">
            <header className="editor-media-heading"><h3><Icon name="link"/>References</h3><p>Library sounds and other inspiration for this cue.</p></header>
            {cue.libraryReference ? <div className="editor-current-media"><LibraryReferenceCard reference={cue.libraryReference}/><Button type="button" onClick={()=>onChange({...cue,libraryReference:null,libraryReferenceId:'',libraryReferenceUrl:''})}>Remove reference</Button></div> : <p className="editor-media-empty">{cue.libraryReferenceId ? `Reference: ${cue.libraryReferenceId}` : 'No library reference. Choose one using the audio search above.'}</p>}
            <div className="editor-media-controls"><Field label="Other reference link (optional)"><input type="url" placeholder="https://…" value={cue.referenceUrl} onChange={e=>patch("referenceUrl",e.target.value)}/></Field></div>
          </section>
        </article>
      ) : (
        <Empty>Select a cue or add a new one.</Empty>
      )}
    </div>
  );
}
