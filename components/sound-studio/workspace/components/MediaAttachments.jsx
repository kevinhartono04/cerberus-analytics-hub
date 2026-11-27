import React,{useEffect,useRef,useState} from 'react';
import {Button,Icon,AudioSourcePicker,FileCredit} from './ui';
import {AudioPreview,VideoPreview} from './Media';
import {downloadUrl,downloadName} from './Library';
import DriveImport from './DriveImport';
import {driveLink,uniqueFiles} from '../cue-media';
import {safeUrl,validateMediaFile} from '../model';
import {isLibraryLink} from '../new-game';
import {repository} from '../adapters/repository';

export default function MediaAttachments({type,files,onChange,sources=[],onSourcesChange,note='',label,assets=[],references=[],reference,onReference,onBusyChange=()=>{}}) {
  const [link,setLink]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[drive,setDrive]=useState(null),[videoOpen,setVideoOpen]=useState({});
  const [dragging,setDragging]=useState(false);
  const dragDepth=useRef(0),uploading=useRef(false);
  const input=useRef(null),busyCallback=useRef(onBusyChange),alive=useRef(true);busyCallback.current=onBusyChange;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{busyCallback.current(busy || Boolean(link));return ()=>busyCallback.current(false);},[busy,link]);
  async function upload(batch) {
    if(!batch?.length || uploading.current)return;
    uploading.current=true;
    setBusy(true);setError('');
    try{
      if(batch.length>50 || batch.reduce((n,file)=>n+file.size,0)>100*1024*1024)throw Error('Attach up to 50 files or 100 MB at a time.');
      batch.forEach(file=>validateMediaFile(file,type));
      const added=[];
      for(const file of batch){const {url}=await repository.upload(file);added.push({url,name:file.name});}
      if(alive.current) await onChange(uniqueFiles([...files,...added]));
    }catch(e){if(alive.current)setError(e.message);throw e;}finally{uploading.current=false;if(alive.current)setBusy(false);}
  }
  function addLink() {
    const value=link.trim();setError('');
    if(!safeUrl(value)){setError('Paste a valid http or https link.');return;}
    if(type==='audio' && isLibraryLink(value)){onReference?.({libraryReference:null,libraryReferenceId:'',libraryReferenceUrl:value});setLink('');return;}
    if(driveLink(value)?.folder) {
      onSourcesChange?.([...sources.filter(source=>source.url!==value),{url:value,type,name:'Google Drive folder'}]);setLink('');setDrive(value);return;
    }
    onChange(uniqueFiles([...files,{url:value,name:''}]));setLink('');
    if(driveLink(value))setDrive(value);
  }
  const isFileDrag=e=>Array.from(e.dataTransfer?.types || []).includes('Files');
  return <div className={'media-attachments'+(type==='audio'?' audio-drop-area':'')+(dragging?' is-dragging':'')} aria-label={label}
    onDragEnter={e=>{if(type!=='audio' || !isFileDrag(e))return;e.preventDefault();dragDepth.current++;if(!uploading.current)setDragging(true);}}
    onDragOver={e=>{if(type!=='audio' || !isFileDrag(e))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=uploading.current?'none':'copy';}}
    onDragLeave={e=>{if(type!=='audio')return;e.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}}
    onDrop={e=>{if(type!=='audio' || !isFileDrag(e))return;e.preventDefault();e.stopPropagation();dragDepth.current=0;setDragging(false);if(!uploading.current)upload(Array.from(e.dataTransfer.files)).catch(()=>{});}}>
    {type==='audio' && <div className="audio-drop-hint"><Icon name="upload" size={18}/><span>{dragging?'Drop audio files here':'Drag audio files here, or use Attach'}<small>One or multiple files · WAV, MP3, OGG, M4A</small></span></div>}
    <div className="attachment-input">
      {type==='audio'?<AudioSourcePicker label={`${label} link or search`} linkValue={link} onLinkChange={setLink} references={references} assets={assets} selectedReference={reference}
        onChooseReference={values=>{onReference?.(values);setLink('');}} onChooseAsset={asset=>{onChange(uniqueFiles([...files,{assetId:asset.id,url:asset.audioUrl,name:asset.name}]));setLink('');}}/>:
        <input aria-label={`${label} link`} value={link} placeholder="Paste video or folder link" onChange={e=>setLink(e.target.value)}/>}
      {link && <Button type="button" onClick={addLink} disabled={busy}>Add</Button>}
      <label className="button attachment-upload"><Icon name="upload" size={14}/>Attach<input ref={input} multiple type="file" aria-label={`Attach ${label}`} accept={type==='audio'?'.wav,.mp3,.ogg,.m4a':'.mp4,.webm,.mov'} disabled={busy} onChange={e=>{const batch=[...e.target.files];e.target.value='';upload(batch).catch(()=>{});}}/></label>
    </div>
    {link && <small className="muted">Press Add to attach this link.</small>}
    {sources.filter(source=>source.type===type).map(source=><div className="media-folder-source" key={source.url}>
      <span><Icon name="folder" size={14}/>{driveLink(source.url)?.folder?(type==='audio'?'Audio folder':'Video folder'):'Drive source'}<small>{source.name}</small></span>
      <Button type="button" disabled={busy} onClick={()=>setDrive(source.url)}>Upload files</Button>
      <Button type="button" icon="close" aria-label={`Remove source ${source.name}`} onClick={()=>onSourcesChange(sources.filter(item=>item!==source))}/>
    </div>)}
    {files.map((file,index)=>{
      const asset=assets.find(a=>a.id===file.assetId) || {id:file.url,audioUrl:file.url,name:file.name || `${type} ${index+1}`,tags:[]};
      const valid=safeUrl(file.url,true),download={...asset,...(type==='video'?{videoUrl:file.url,name:file.name || 'Video'}:{})};
      return <div className="cue-attachment" key={file.assetId || file.url}>
        <div className="attachment-heading"><strong title={file.name}>{file.name || `${type==='audio'?'Audio':'Video'} ${index+1}`}</strong><button type="button" aria-label={`Remove ${file.name || type+' '+(index+1)}`} disabled={busy} onClick={()=>onChange(files.filter((_,i)=>i!==index))}><Icon name="close" size={14}/></button></div>
        {valid ? type==='audio'?<AudioPreview asset={asset} compact/>:<><Button type="button" onClick={()=>setVideoOpen(current=>({...current,[file.url]:!current[file.url]}))}>{videoOpen[file.url]?'Hide preview':'Preview video'}</Button>{videoOpen[file.url] && <VideoPreview url={file.url} showHeading={false}/>}</>:<small>File not attached. Upload it or add a link.</small>}
        <div className="attachment-actions">{valid && <a href={downloadUrl(file.url)} download={/^(\/|data:)/.test(file.url)?downloadName(download):undefined} target={/^(\/|data:)/.test(file.url)?undefined:'_blank'} rel="noreferrer"><Icon name="download" size={12}/>Download</a>}
          {driveLink(file.url) && <Button type="button" disabled={busy} onClick={()=>setDrive(file.url)}>Upload manually</Button>}</div>
        {type==='audio' && asset.createdAt && <FileCredit record={asset}/>}
        {type==='video' && file.audit && <FileCredit record={file.audit}/>}
      </div>;
    })}
    {note && <p className="media-source-note"><strong>Spreadsheet note</strong>{note}</p>}
    {busy && <small role="status">Attaching files…</small>}
    {error && <p role="alert" className="new-field-error">{error}</p>}
    {drive && <DriveImport source={drive} type={type} onManual={()=>input.current?.click()} onClose={()=>setDrive(null)}/>}
  </div>;
}
