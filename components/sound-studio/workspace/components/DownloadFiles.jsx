import React,{useEffect,useRef,useState} from 'react';
import {Button,Modal} from './ui';
import {canDownloadFile,downloadArchive,uniqueDownloads} from '../download-files';

export default function DownloadFiles({files,name='Sound files',disabled=false}) {
  const [open,setOpen]=useState(false),[selected,setSelected]=useState([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[result,setResult]=useState(null),[error,setError]=useState('');
  const controller=useRef(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
  const all=uniqueDownloads(files),available=all.filter(canDownloadFile),links=all.length-available.length;
  function close(){if(busy){controller.current?.abort();return;}setOpen(false);}
  async function start(batch){
    controller.current=new AbortController();setBusy(true);setError('');setResult(null);
    try{
      const outcome=await downloadArchive(batch,{signal:controller.current.signal,onProgress:(done,total)=>{if(alive.current)setProgress(`Preparing ${done} of ${total} files…`);}});
      if(!alive.current)return;
      if(outcome.bytes){
        const url=URL.createObjectURL(new Blob([outcome.bytes],{type:'application/zip'}));
        const a=document.createElement('a');a.href=url;a.download=name.replace(/[^\w -]/g,'_')+(outcome.failures.length?' - partial':'')+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      }
      setResult(outcome);
    }catch(e){if(alive.current)setError(e.name==='AbortError'?'Download canceled.':e.message);}
    finally{if(alive.current){setBusy(false);setProgress('');}}
  }
  return <>
    <Button icon="download" disabled={disabled || !all.length} onClick={()=>{setSelected(available.map(f=>f.url));setResult(null);setError('');setOpen(true);}}>Download files</Button>
    {open && <Modal title="Download files" onClose={close} className="download-files-modal">
      <p>{available.length} of {all.length} files available for ZIP download.</p>
      {links>0 && <p className="download-notice">{links} link-only files need source access and cannot be included here. Upload them manually to include them in a ZIP.</p>}
      <div className="download-selection-actions"><Button disabled={busy || !available.length} onClick={()=>setSelected(available.map(f=>f.url))}>Select all available</Button><Button disabled={busy || !selected.length} onClick={()=>setSelected([])}>Clear selection</Button><span>{selected.length} selected</span></div>
      <div className="download-file-list">{all.map(file=><label className="download-file-row" key={file.url}>
        <input type="checkbox" checked={selected.includes(file.url)} disabled={busy || !canDownloadFile(file)} onChange={e=>setSelected(current=>e.target.checked?[...current,file.url]:current.filter(url=>url!==file.url))} aria-label={`Select ${file.name}`}/>
        <span><strong>{file.name || 'Unnamed file'}</strong><small>{file.type || 'Media'}{!canDownloadFile(file)?' · Source access required':''}</small></span>
      </label>)}</div>
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
      {result && <div role="status"><p>{result.count ? `${result.count} files downloaded${result.failures.length?' in a partial ZIP':''}.`:'No files could be downloaded.'}</p>{result.failures.length>0 && <><p>These files were not included. Upload them manually or check source access:</p><ul>{result.failures.map((failure,i)=><li key={i}>{failure}</li>)}</ul></>}</div>}
      <footer className="actions"><Button onClick={close}>{busy?'Cancel download':'Close'}</Button><Button disabled={busy || !available.length} onClick={()=>start(available)}>Download {links?'available':'all'} as ZIP</Button><Button kind="primary" disabled={busy || !selected.length} onClick={()=>start(available.filter(f=>selected.includes(f.url)))}>Download selected ({selected.length})</Button></footer>
    </Modal>}
  </>;
}
