import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MediaAttachments from './MediaAttachments';
import {rowFiles,setRowFiles} from '../cue-media';
import { Button, Field, Icon, GameIconUpload, AudioSourcePicker, categoryKey } from './ui';
import { CATEGORIES, STATUSES, cueDescription, safeUrl, validateMediaFile } from '../model';
import { IMPORT_FIELDS, SOUND_SUGGESTIONS, blankDraftRow, hasDraftContent, audioLinkChange, isLibraryLink, templateRows, readSpreadsheet, selectSoundSheet, prepareSheet, importLinks, rowsFromSheet, rowErrors, rowsForGame, createGameFromRows } from '../new-game';

function SuggestedInput({ label, value, placeholder, suggestions, onChange, invalid, multiline = false }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const id = useId(), inputRef = useRef(null), popupRef = useRef(null);
  const [position, setPosition] = useState({left:0, top:0, width:240});
  const InputTag = multiline ? 'textarea' : 'input';
  const matches = [...new Set(suggestions)].filter(text => text.toLowerCase().includes(value.toLowerCase()));
  useLayoutEffect(() => {
    if (!open || !matches.length) return;
    const place = () => {
      const rect = inputRef.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {setOpen(false); return;}
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
      const height = Math.min(240, matches.length * 34 + 62);
      setPosition({width, left:Math.max(8, Math.min(rect.left, window.innerWidth-width-8)), top:window.innerHeight-rect.bottom >= height+8 ? rect.bottom+4 : Math.max(8,rect.top-height-4)});
    };
    const outside = event => {if (!inputRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) setOpen(false);};
    place();
    const observer = new ResizeObserver(place); observer.observe(inputRef.current);
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    document.addEventListener('pointerdown',outside);
    return () => {observer.disconnect();window.removeEventListener('resize',place); window.removeEventListener('scroll',place,true); document.removeEventListener('pointerdown',outside);};
  }, [open, matches.length]);
  useEffect(() => {
    if (open && active >= 0) popupRef.current?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView({block:'nearest'});
  }, [open, active, id]);
  return <div className="new-suggest" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !popupRef.current?.contains(event.relatedTarget)) setOpen(false); }}>
    <InputTag rows={multiline ? 2 : undefined} ref={inputRef} role="combobox" aria-label={label} value={value} placeholder={placeholder} autoComplete="off" aria-autocomplete="list" aria-expanded={open && matches.length > 0} aria-controls={open && matches.length ? id : undefined} aria-describedby={open && matches.length ? `${id}-hint` : undefined} aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-${active}` : undefined} aria-invalid={invalid}
      onFocus={() => {setOpen(true); setActive(-1);}} onClick={() => setOpen(true)} onChange={event => {onChange(event.target.value); setOpen(true); setActive(-1);}}
      onKeyDown={event => {
        if (event.key === 'Escape') {setOpen(false); return;}
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault(); setOpen(true); setActive(i => matches.length ? (i + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : -1);}
        if (event.key === 'Enter' && open) {if (active >= 0 && matches[active]) {event.preventDefault(); onChange(matches[active]);} else if (!multiline) event.preventDefault(); setOpen(false);}
      }}/>
    {open && matches.length > 0 && createPortal(<div ref={popupRef} className="new-suggestion-popup" style={position}>
      <div className="new-suggestion-heading"><strong>Suggestions</strong><small id={`${id}-hint`}>Choose one or type your own</small></div>
      <div id={id} role="listbox" aria-label={`${label} suggestions`} className="new-suggestion-list">{matches.map((text,index) => <button key={text} id={`${id}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={active === index} onMouseDown={event => event.preventDefault()} onClick={() => {onChange(text); setOpen(false); inputRef.current?.focus();}}>{text}</button>)}</div>
    </div>,inputRef.current?.closest(".sound-studio") || document.body)}
  </div>;
}

export default function NewGame({ onCancel, onSave, onDirty, busy, initialGame = null, referenceCatalog = [], assets = [] }) {
  const restored = initialGame?.workingDraft;
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const [name, setName] = useState(restored?.name ?? initialGame?.name ?? '');
  const [iconUrl,setIconUrl] = useState(restored?.iconUrl ?? initialGame?.iconUrl ?? ''), [iconReading,setIconReading] = useState(false);
  const [rows, setRows] = useState(() => restored?.rows || (initialGame ? rowsForGame(initialGame, assets) : templateRows()));
  const [workbook, setWorkbook] = useState(restored?.workbook || []), [sheet, setSheet] = useState(restored?.sheet || null), [mapping, setMapping] = useState(restored?.mapping || {});
  const [filename, setFilename] = useState(restored?.filename || ''), [sheetIndex, setSheetIndex] = useState(restored?.sheetIndex || 0);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [attempted, setAttempted] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [linkChoices, setLinkChoices] = useState(restored?.linkChoices || {});
  const [rowEdits, setRowEdits] = useState(Boolean(initialGame)), [uploading, setUploading] = useState(0);
  const readToken = useRef(0);
  const pendingMedia=useRef(new Set());
  function mediaBusy(key,value){if(value)pendingMedia.current.add(key);else pendingMedia.current.delete(key);setUploading(pendingMedia.current.size);}
  useEffect(() => () => { readToken.current++; onDirty(false); }, [onDirty]);
  const errors = rows.map(row => rowErrors(row, rows));
  const activeRows = rows.filter(hasDraftContent);
  const touch = () => onDirty(true);
  function patch(id, values) {
    touch(); setRowEdits(true); setError('');
    setRows(current => current.map(row => row.id === id ? { ...row, ...values } : row));
  }
  function replaceAllowed() { return !rowEdits || confirm('Replace the current cue edits with this selection?'); }
  function loadSheet(next, index) {
    setSheetIndex(index); setSheet(null); setMapping({}); setLinkChoices({}); setRows([]); setRowEdits(false); setAttempted(false); setError('');
    const prepared = prepareSheet(next);
    setSheet(prepared); setSheetIndex(index); setMapping(prepared.mapping); setLinkChoices({});
    setRows(rowsFromSheet(prepared)); setRowEdits(false); setAttempted(false); setError(''); touch();
  }
  async function importFile(file) {
    if (!file || loading || busy || uploading || iconReading || !replaceAllowed()) return;
    const token = ++readToken.current;
    setLoading(true); setError('');
    try {
      const sheets = await readSpreadsheet(file);
      if (token !== readToken.current) return;
      if (!sheets.length) throw Error('No visible sheets found in this workbook.');
      setWorkbook(sheets); setFilename(file.name);
      const candidate = selectSoundSheet(sheets);
      const first = candidate >= 0 ? candidate : sheets.length === 1 ? 0 : -1;
      if (first >= 0) loadSheet(sheets[first], first);
      else {
        setSheetIndex(-1); setSheet(null); setMapping({}); setLinkChoices({}); setRows([]); setRowEdits(false);
        setError('Choose the sheet containing your sounds. No sound sheet was confidently detected.'); touch();
      }
    } catch (e) { if (token === readToken.current) setError(e.message); }
    finally { if (token === readToken.current) setLoading(false); }
  }
  function remap(field, value) {
    if (!replaceAllowed()) return;
    const next = { ...mapping, [field]: Number(value) };
    // Each source column can fill one destination; ambiguous mappings are explicit.
    if (Number(value) >= 0) for (const key of Object.keys(next)) if (key !== field && next[key] === Number(value)) next[key] = -1;
    setMapping(next); setLinkChoices({}); setRows(rowsFromSheet(sheet, next)); setRowEdits(false); touch();
  }
  const unresolved = rows.flatMap(row => row.pendingLinks || []);
  const clarifyLinks = sheet ? importLinks(sheet,mapping).filter(item => !item.type || unresolved.some(link=>link.key===item.key)) : [];
  const clarifyColumns = [...new Set(clarifyLinks.map(item=>item.column))];
  function chooseLink(key, value) {
    if (!replaceAllowed()) return;
    const next = { ...linkChoices, [key]: value };
    // A new column-wide decision clears prior choices for individual rows.
    if (!String(key).includes(':')) for (const item of Object.keys(next)) if (item.startsWith(`${key}:`)) delete next[item];
    setLinkChoices(next); setRows(rowsFromSheet(sheet,mapping,next)); setRowEdits(false); touch();
  }
  const linkOptions = <><option value="">Choose option</option><option value="audio">Audio</option><option value="video">Video</option><option value="reference">Reference only</option></>;
  function sourceSelect(field) {
    return sheet && showMapping ? <select aria-label={`Source column for ${IMPORT_FIELDS[field].label}`} className="source-column" value={mapping[field] ?? -1} onChange={e => remap(field, e.target.value)}>
      <option value={-1}>No source column</option>
      {sheet.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}
    </select> : null;
  }
  return <form className="new-game" onSubmit={async event => {
    event.preventDefault(); setAttempted(true); setError('');
    if (!name.trim() || loading || uploading || iconReading) { setError('Enter a game title before saving.'); return; }
    setAttempted(false);
    onSave(specStatus => {
      setAttempted(specStatus === 'final');
      const created = createGameFromRows(name, initialGame?.externalGameId || '', rows, assets, initialGame, specStatus);
      created.game.iconUrl = iconUrl;
      return created;
    });
  }}>
    <section className="new-game-setup">
      <div className="new-game-fields new-game-title-row">
        <Field label="Game title"><input aria-label="Game title" value={name} placeholder="Enter the game title" aria-invalid={attempted && !name.trim()} onChange={e => {setName(e.target.value); touch();}} maxLength={120}/></Field>
        <div className="new-game-icon"><span className="game-icon-caption">Game icon (optional)</span><div>{iconUrl && <img className="game-icon-preview" src={iconUrl} alt="Game icon preview"/>}<GameIconUpload label={iconUrl ? 'Change icon' : 'Add icon'} onBusyChange={setIconReading} onChange={url => {setIconUrl(url);touch();}}/></div></div>
      </div>
        <div className={'new-import-file spreadsheet-dropzone' + (dragOver ? ' is-dragging' : '')} aria-label="Spreadsheet drop area" aria-busy={loading}
          onDragEnter={event => {event.preventDefault(); if (event.dataTransfer.types.includes('Files')) {dragDepth.current++;setDragOver(true);}}}
          onDragOver={event => {event.preventDefault();event.dataTransfer.dropEffect=loading || busy ? 'none' : 'copy';}}
          onDragLeave={event => {event.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragOver(false);}}
          onDrop={event => {event.preventDefault();dragDepth.current=0;setDragOver(false);if(loading || busy || uploading || iconReading)return;const files=[...event.dataTransfer.files];if(files.length!==1){setError('Drop one XLSX or CSV file at a time.');return;}importFile(files[0]);}}><Icon name="upload" size={23}/><div><strong>{dragOver ? 'Drop spreadsheet here' : filename || 'Drag and drop a spreadsheet'}</strong><small>{loading ? 'Reading spreadsheet…' : filename ? 'Columns matched automatically. Review and edit the fields below.' : 'Optional · XLSX or CSV · Up to 10 MB · 500 cues per sheet'}</small></div>
          {workbook.length > 0 && <label className="new-sheet">Sheet<select aria-label="Spreadsheet sheet" value={sheetIndex} disabled={loading} onChange={e => {
            if (!replaceAllowed() || e.target.value === '-1') return; try { loadSheet(workbook[Number(e.target.value)], Number(e.target.value)); } catch (err) {setError(err.message);}
          }}><option value={-1} disabled>Choose a sheet</option>{workbook.map((s,i) => <option key={i} value={i}>{s.name}</option>)}</select></label>}
          <label className="button new-file-upload"><Icon name="upload"/>{filename ? 'Replace file' : 'Browse files'}<input type="file" aria-label="Import spreadsheet file" accept=".xlsx,.csv" disabled={loading || busy || uploading > 0 || iconReading} onChange={e => {importFile(e.target.files[0]); e.target.value='';}}/></label>
        </div>
        {clarifyColumns.length > 0 && <div className={"import-link-questions" + (unresolved.length ? " needs-attention" : "")} aria-label="Classify imported links">
          <div className="import-question-heading"><strong>Where should these links go?</strong>{unresolved.length > 0 && <span className="import-action-badge"><Icon name="info" size={14}/>Action needed</span>}</div><small>Choose Audio, Video, or Reference only for each group of links.</small>
          {clarifyColumns.map(column => {
            const items = clarifyLinks.filter(item=>item.column===column);
            const perRow = linkChoices[column] === 'mixed';
            return <div className="import-link-question" key={column}>
              <label><span>“{sheet.headers[column]}” · {items.length} {items.length===1?'link':'links'}</span><select aria-label={`Use ${sheet.headers[column]} links as`} value={linkChoices[column] || ''} onChange={e=>chooseLink(column,e.target.value)}>{linkOptions}<option value="mixed">Choose per row</option></select></label>
              {perRow && items.map(item=><label className="import-link-row" key={item.key}><span>Row {item.index+1} · {rows[item.index]?.name || 'Untitled cue'}<a href={item.url} target="_blank" rel="noreferrer">Open source <Icon name="external" size={11}/></a></span><select aria-label={`Link type for ${sheet.headers[column]} row ${item.index+1}`} value={linkChoices[item.key] || ''} onChange={e=>chooseLink(item.key,e.target.value)}>{linkOptions}</select></label>)}
            </div>;
          })}
          {unresolved.length > 0 && <small>{unresolved.length} unassigned {unresolved.length===1?'link':'links'} · Choose a destination before saving. Existing media will not be overwritten.</small>}
        </div>}
        {sheet && <small className="new-import-note">Sheet: {workbook[sheetIndex]?.name} · Imported values are kept. Empty fields show suggestions only; they are not saved as values.</small>}
    </section>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="new-cues">
      <div className="new-cues-heading"><div><h2>Sound cues</h2><p>{activeRows.length} sound cues · {sheet ? 'Imported values kept' : 'Choose a suggestion or type your own'}</p></div><div className="actions">{sheet && <Button type="button" aria-pressed={showMapping} onClick={() => setShowMapping(value => !value)}>Match columns</Button>}</div></div>
      {sheet && showMapping && <div className="list-column-mapping">{Object.keys(IMPORT_FIELDS).map(field=><label key={field}>{field === 'description' ? 'Description / combined text source' : field === 'trigger' ? 'Trigger / Event source (legacy)' : IMPORT_FIELDS[field].label}{sourceSelect(field)}</label>)}</div>}
      {!rows.length ? <div className="empty"><Icon name="upload" size={28}/><p>Add a cue or import a spreadsheet to start your sound list.</p></div> : <div className="new-table-scroll"><table className="new-cue-table"><thead><tr>
        {['name','category','description','audio','video','status','notes'].map(field => <th key={field}>{IMPORT_FIELDS[field].label}</th>)}<th><span className="sr-only">Remove</span></th>
      </tr></thead><tbody>{rows.map((row,index) => {
        const issues = attempted && hasDraftContent(row) || row.sourceRow ? errors[index] : {};
        const suggestions = SOUND_SUGGESTIONS.filter(s => !row.category || s[1] === row.category);
        const hint = SOUND_SUGGESTIONS.find(s => s[0] === row.name) || (row.suggestion && (!row.category || row.suggestion[1] === row.category) ? row.suggestion : suggestions[0]);
        const edit = (field, label, hintIndex) => <>
          {field === 'description' ? <textarea aria-label={`${label} row ${index+1}`} value={row[field]} placeholder={`e.g. ${hint?.[hintIndex] || 'Describe the sound'}`} rows={2} onChange={e => patch(row.id,{[field]:e.target.value})}/> : <SuggestedInput multiline={field === 'trigger'} label={`${label} row ${index+1}`} value={row[field]} placeholder={`e.g. ${hint?.[hintIndex] || (field === 'name' ? 'custom_sound' : 'When to play')}`} suggestions={suggestions.map(s => s[hintIndex])} invalid={Boolean(issues[field])} onChange={value => patch(row.id,{[field]:value})}/>}
          {issues[field] && <small className="new-field-error">{issues[field]}</small>}
        </>;
        const media = type => <td data-label={type==='audio'?'Audio files':'Video files (optional)'}>
          <MediaAttachments key={row.id+type} type={type} label={type+' row '+(index+1)} files={rowFiles(row,type,assets)}
            onChange={files=>patch(row.id,setRowFiles({},type,files))} assets={assets} references={referenceCatalog} reference={row.libraryReference}
            onReference={values=>patch(row.id,values)} sources={row.mediaSources || []} onSourcesChange={mediaSources=>patch(row.id,{mediaSources})}
            note={row.mediaNotes?.[type]} onBusyChange={value=>mediaBusy(row.id+type,value)}/>
          {type==='audio' && (row.libraryReferenceUrl || row.libraryReference) && <div className="new-selected-reference"><span>{row.libraryReference?.title || 'Cerberator reference'}</span><button type="button" aria-label={'Remove library reference row '+(index+1)} onClick={()=>patch(row.id,{libraryReference:null,libraryReferenceId:'',libraryReferenceUrl:''})}>×</button></div>}
          {type==='audio' && row.referenceUrl && <a className="new-field-note" href={safeUrl(row.referenceUrl)?row.referenceUrl:undefined} target="_blank" rel="noreferrer">Reference link</a>}
          {issues[type+'Input'] && <small className="new-field-error">{issues[type+'Input']}</small>}
        </td>;
        return <tr key={row.id}>
          <td data-label="Sound ID">{edit('name','Sound ID',0)}{row.importWarnings?.map((warning,i)=><small key={i} className="new-field-note">{warning}</small>)}</td>
          <td data-label="Category"><select aria-label={`Category row ${index+1}`} className="category-tag" data-category={categoryKey(row.category)} value={row.category} aria-invalid={Boolean(issues.category)} onChange={e => patch(row.id,{category:e.target.value})}><option value="">Choose Option</option>{CATEGORIES.map(c => <option key={c} value={c}>{c === 'Level state' ? 'Level State' : c}</option>)}</select>{issues.category && <small className="new-field-error">{row.importedCategory ? `Imported: ${row.importedCategory}. ` : ''}{issues.category}</small>}</td>
          <td data-label="Description/Trigger When (optional)"><textarea aria-label={`Description/Trigger When row ${index+1}`} value={cueDescription(row)} placeholder={`e.g. ${hint?.[2] || 'Describe the sound or when it plays'}`} rows={3} onChange={e=>patch(row.id,{description:e.target.value,trigger:''})}/></td>
          {media('audio')}{media('video')}
          <td data-label="Current Status"><select aria-label={`Current Status row ${index+1}`} className={'status-select status-'+row.status.toLowerCase().replaceAll(' ','-')} value={row.status || 'Open'} aria-invalid={Boolean(issues.status)} onChange={e => patch(row.id,{status:e.target.value})}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>{issues.status && <small className="new-field-error">{row.importedStatus ? `Imported value: ${row.importedStatus}. ` : ''}{issues.status}</small>}</td>
          <td data-label="Notes (optional)"><textarea aria-label={`Notes row ${index+1}`} value={row.notes || ''} placeholder="Optional notes" rows={2} onChange={e=>patch(row.id,{notes:e.target.value})}/></td>
          <td data-label="Remove"><Button type="button" icon="trash" aria-label={`Remove cue row ${index+1}`} onClick={() => {setRows(current => current.filter(r => r.id !== row.id)); setRowEdits(true); touch();}}/></td>
        </tr>;
      })}</tbody></table></div>}
      <div className="new-add-cue"><Button type="button" icon="plus" disabled={loading || rows.length >= 500} onClick={() => {
        setRows(current => [...current, blankDraftRow()]); setRowEdits(true); touch();
      }}>Add cue</Button></div>
      <footer className="new-game-footer"><small>Save your work, then choose Draft or Final. Both appear in Sound Specs.</small><div><Button type="button" disabled={busy || loading || uploading > 0 || iconReading} onClick={onCancel}>Cancel</Button><Button type="submit" kind="primary" disabled={busy || loading || uploading > 0 || iconReading}>{busy ? 'Saving…' : uploading ? 'Reading media…' : 'Save'}</Button></div></footer>
    </section>
  </form>;
}
