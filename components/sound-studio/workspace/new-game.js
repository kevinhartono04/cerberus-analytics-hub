import { CATEGORIES, STATUSES, normalizeStatus, emptyCue, safeUrl } from './model.js';
import {setCueAudio, rowFiles, setRowFiles, driveLink, mediaType} from './cue-media.js';

export const SOUND_SUGGESTIONS = [
  ['button_tap', 'UI', 'Short, soft button click', 'Tap a button'],
  ['window_open', 'UI', 'Gentle popup sound', 'Open a window'],
  ['window_close', 'UI', 'Soft closing sound', 'Close a window'],
  ['level_start', 'Level state', 'Short start cue', 'Start a level'],
  ['level_win', 'Level state', 'Bright completion sound', 'Complete a level'],
  ['level_fail', 'Level state', 'Gentle failure cue', 'Fail a level'],
  ['gameplay_loop', 'Music', 'Calm looping gameplay music', 'During gameplay'],
  ['reward_collect', 'Reward', 'Short reward chime', 'Collect a reward'],
];
export const IMPORT_FIELDS = {
  name: { label: 'Sound ID', aliases: ['sound id', 'sound_id', 'cue', 'cue name', 'sound name', 'name', 'id', 'sound'] },
  category: { label: 'Category', aliases: ['category', 'type', 'group', 'function', 'sound type', 'audio type'] },
  description: { label: 'Description/Trigger When', aliases: ['description/trigger when', 'description trigger when', 'description', 'sound description', 'description of the sound music', 'description of the sound'] },
  trigger: { label: 'Trigger / When to play', aliases: ['trigger', 'when to play', 'trigger when to play', 'placement', 'condition', 'condition when to play', 'event'] },
  audio: { label: 'Audio file', aliases: ['audio file', 'audio', 'audio link', 'sound file', 'audio filename', 'audio url', 'creator audio url', 'sound link', 'sound url', 'audio file link', 'audio file url', 'sound file link', 'sound music', 'sfx link', 'reference audio', 'reference audio file', 'final file', 'final file wav format'] },
  status: { label: 'Current Status', aliases: ['status', 'current status', 'progress', 'implementation status'] },
  video: { label: 'Video file (optional)', aliases: ['video', 'video preview', 'video link', 'video url', 'creator video url', 'animation', 'animation link', 'video file', 'video file optional', 'video file link', 'video file url', 'video reference', 'video preview link', 'preview video'] },
  notes: { label: 'Notes (optional)', aliases: ['notes', 'note', 'comments', 'comment', 'remarks'] },
  reference: { label: 'Reference link', aliases: ['reference', 'reference link', 'reference url', 'image preview'] },
  libraryId: { label: 'Cerberator reference ID', aliases: ['cerberator reference id', 'library id', 'library reference id'] },
  libraryUrl: { label: 'Cerberator reference link', aliases: ['cerberator reference link', 'library reference link', 'library url'] },
};
const key = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const aliases = Object.fromEntries(Object.entries(IMPORT_FIELDS).map(([field, value]) => [field, value.aliases.map(key)]));
export const cellText = value => typeof value === 'object' && value ? (value.richText ? value.richText.map(part=>part.text || '').join('') : cellText(value.text ?? value.result ?? '')) : String(value ?? '');
const cellLink = value => {
  const text = (typeof value === 'object' && value ? value.hyperlink || cellText(value) : cellText(value)).trim();
  if (safeUrl(text, true) && !/\s/.test(text)) return text;
  const urls = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return urls.length === 1 ? urls[0].replace(/[.,;)]+$/, '') : text;
};
function mediaEvidence(cell, type) {
  const value = cellLink(cell), text = cellText(cell);
  const suffix = type === 'audio' ? /\.(wav|mp3|ogg|m4a|aac|flac)(?:[?#\s]|$)/i : /\.(mp4|mov|webm|m4v)(?:[?#\s]|$)/i;
  return safeUrl(value) && (suffix.test(value) || suffix.test(text) || (type === 'video' && /https?:\/\/(?:www\.)?(?:youtu\.be|youtube\.com|vimeo\.com)\//i.test(value)));
}
export function blankDraftRow(suggestion) {
  return { ...emptyCue(), name: '', category: '', description: '', trigger: '', status: '', audioInput: '', videoInput: '', suggestion };
}
export function templateRows() {
  return SOUND_SUGGESTIONS.slice(0, 5).map(suggestion => blankDraftRow(suggestion));
}
export function hasDraftContent(row) {
  return Boolean(row.sourceRow || row.extraAudio?.length || row.extraVideo?.length || row.mediaSources?.length || ['name','category','description','trigger','notes','status','audioInput','videoInput','referenceUrl','libraryReferenceId','libraryReferenceUrl','existingAssetId'].some(field => row[field]?.trim()));
}
export function isLibraryLink(value) {
  try { return ['woylie-quoll-galah.vercel.app', 'cerberator.tripledotstudios.com'].includes(new URL(value).hostname); } catch { return false; }
}
export function audioLinkChange(row, value) {
  if (!value && !row.audioInput) return {libraryReference:null,libraryReferenceId:'',libraryReferenceUrl:''};
  const referenceChange = value === row.libraryReferenceUrl ? {} : {libraryReference:null,libraryReferenceId:''};
  if (isLibraryLink(value)) return { ...referenceChange, libraryReferenceUrl:value, audioInput:row.audioInput || '', audioName:row.audioName || '' };
  // The link box beside an attached file is an optional library reference.
  if (row.audioInput?.startsWith('data:') || row.existingAssetId) return { ...referenceChange, libraryReferenceUrl:value };
  return { audioInput:value, audioName:'', existingAssetId:null };
}
export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0];
  const separator = [',', ';', '\t'].sort((a,b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && (quoted || !value)) {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (ch === separator && !quoted) { row.push(value); value = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += ch;
  }
  if (quoted) throw Error('This CSV has an unclosed quoted value. Check the file and try again.');
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
export async function readSpreadsheet(file) {
  if (!/\.(xlsx|csv)$/i.test(file.name) || file.size > 10 * 1024 * 1024) throw Error('Choose an XLSX or CSV file under 10 MB.');
  if (/\.csv$/i.test(file.name)) return [{ name: 'CSV', rows: parseCsv(await file.text()) }];
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(await file.arrayBuffer()); } catch { throw Error('Could not read this workbook. Use an unprotected .xlsx file or export it as CSV.'); }
  return book.worksheets.filter(sheet => sheet.state === 'visible').map(sheet => {
    if (sheet.rowCount > 5000 || sheet.columnCount > 100) return {name:sheet.name, rows:[], error:'This sheet exceeds 5,000 rows or 100 columns. Choose another sheet or reduce it.'};
    const rows = [];
    sheet.eachRow({ includeEmpty: true }, row => {
      const cells = [];
      for (let i = 1; i <= sheet.columnCount; i++) {
        const cell = row.getCell(i), v = cell.value;
        if (v?.hyperlink) cells.push({ text: cellText(v), hyperlink: v.hyperlink });
        else if (v?.formula) {
          const link = v.formula.match(/^HYPERLINK\(\s*"([^"]+)"/i)?.[1];
          cells.push(link ? { text: cellText(v), hyperlink: link } : cellText(v));
        } else cells.push(cellText(v));
      }
      rows.push(cells);
    });
    return { name: sheet.name, rows };
  });
}
export function prepareSheet(sheet) {
  if (sheet.error) throw Error(sheet.error);
  const rows = sheet.rows;
  if (rows.length > 5000 || rows.some(row => row.length > 100)) throw Error('Use a sheet with at most 5,000 rows and 100 columns.');
  let headerIndex = -1, best = 0;
  rows.slice(0, 30).forEach((row, index) => {
    const score = Object.values(aliases).filter(names => row.some(cell => names.includes(key(cellText(cell))))).length;
    if (score > best) { best = score; headerIndex = index; }
  });
  if (headerIndex < 0) headerIndex = rows.findIndex(row => row.some(v => cellText(v).trim()));
  if (headerIndex < 0) throw Error('This sheet is empty. Choose a sheet with a header and sound rows.');
  const headers = rows[headerIndex].map((v, i) => cellText(v).trim() || `Column ${i + 1}`);
  const mapping = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, headers.findIndex(h => names.includes(key(h)))]));
  const data = rows.slice(headerIndex + 1).filter(row => row.some(v => cellText(v).trim())).filter(row => !headers.every((h, i) => key(h) === key(cellText(row[i]))));
  if (!data.length) throw Error('No sound rows found below the header.');
  if (data.length > 500) throw Error('Import up to 500 sound cues at a time.');
  for (const type of ['audio','video']) {
    const recognized = headers.map((h,i) => aliases[type].includes(key(h)) ? i : -1).filter(i => i >= 0);
    // Prefer a usable URL column to a filename-only column, preserving filenames in extras.
    const candidates = recognized;
    if (candidates.length) mapping[type] = candidates.sort((a,b) => data.filter(row => safeUrl(cellLink(row[b]))).length - data.filter(row => safeUrl(cellLink(row[a]))).length)[0];
  }
  return { headers, mapping, data, sheetName: sheet.name, suggestIdsFromEvent: mapping.name < 0 && key(headers[mapping.trigger]) === 'event' };
}
// Rank all usable tabs. Sound-specific names and media headers outrank generic Name/ID columns.
export function selectSoundSheet(sheets) {
  let bestIndex = -1, bestScore = 0;
  sheets.forEach((sheet,index) => {
    try {
      const prepared = prepareSheet(sheet), m = prepared.mapping;
      const namedSound = /\b(sfx|sounds?|audio|music)\b/.test(key(sheet.name));
      const unrelated = /\b(haptics?|milestones?|roadmap|bots?|features?|analytics|events?)\b/.test(key(sheet.name)) && !namedSound;
      const identity = m.name >= 0 || prepared.suggestIdsFromEvent;
      const media = Number(m.audio >= 0) + Number(m.video >= 0);
      const soundId = m.name >= 0 && /\b(sound|cue)\b/.test(key(prepared.headers[m.name]));
      if (!identity || (!namedSound && !soundId && !media)) return;
      const score = (namedSound ? 100 : 0) + (soundId ? 30 : 0) + media * 20 + Number(m.category >= 0) * 8 + Number(m.status >= 0) * 5 - (unrelated ? 100 : 0) - (/\b(before|backup|archive|old)\b/.test(key(sheet.name)) ? 80 : 0);
      if (score > bestScore) {bestIndex=index; bestScore=score;}
    } catch { /* Keep unreadable tabs in the selector; they must not block other sheets. */ }
  });
  return bestIndex;
}
// Generic link columns are classified cell by cell. Opaque links require an editor choice.
export function importLinks(sheet, mapping = sheet.mapping) {
  const claimed = new Set(Object.values(mapping));
  return sheet.headers.flatMap((header, column) => claimed.has(column) ? [] : sheet.data.flatMap((row, index) => {
    const cell = row[column], url = cellLink(cell);
    if (!safeUrl(url)) return [];
    const type = isLibraryLink(url) ? 'library' : mediaEvidence(cell, 'audio') ? 'audio' : mediaEvidence(cell, 'video') ? 'video' : '';
    return [{ column, index, header, url, name: cellText(cell), type, key: `${column}:${index}` }];
  }));
}
function categoryValue(value) {
  const normalized = key(value).replace(/^sfx\s+(?=ui|core gameplay|gameplay|reward|booster|level state)/,'');
  return CATEGORIES.find(c => key(c) === normalized) || ({ 'bgm':'Music','core gameplay':'Gameplay','level state': 'Level state', 'sfx': 'Gameplay', 'sound effect': 'Gameplay', 'lobby': 'Menu', 'lte': 'Menu', 'reward menu': 'Menu', 'reward menu lobby lte': 'Menu', 'background music': 'Music' })[normalized] || '';
}
// Separate mixed spreadsheet text by meaning without inventing missing content.
// Short event/sub-event labels form the ID; timing clauses form the trigger.
function splitCueText(value, mode = 'event') {
  const result = {title:[], description:[], trigger:[]};
  let previous = '';
  const soundDetail = /^(?:(?:a|an)\s+)?(?:short|long|soft|gentle|bright|dark|sharp|quiet|loud|subtle|deep|high|low|looping|cheerful|warm|metallic|wooden|muffled|crisp)\b.*\b(?:sound|click|tone|chime|whoosh|music|loop|sparkle|impact|stinger|jingle|sfx)\b/i;
  const condition = /^(?:when|whenever|while|during|after|before|once|as soon as|on (?:tap|click|press|release|enter|exit))\b\s+\S/i;
  const placement = /^(?:all |the )?(?:cards?|players?|stack\b.*|coins?|points?|fire|animation|window|screen)\s+.*\b(?:are|is|being|appears|disappears|flies|moves|returns)\b\s+\S/i;
  const clean = text => text.trim().replace(/^[-–—:;|]+\s*/, '').replace(/\s+[-–—:;|]+$/, '').trim();
  const add = (field, text) => {text=clean(text);if(text){result[field].push(text);previous=field;}};
  // Dashes within words are preserved. Spaced dashes and newlines delimit clauses.
  for(const raw of value.split(/\r?\n|[ \t]+[-–—|][ \t]+|;[ \t]*/)) {
    const part=clean(raw);if(!part)continue;
    const label=part.match(/^(sound id|sound name|cue|description|trigger|when to play)\s*:\s*(.*)$/i);
    if(label) {add(/description/i.test(label[1])?'description':/trigger|when to play/i.test(label[1])?'trigger':'title',label[2]);continue;}
    const timing=part.match(/\b(?:when|whenever)\s+\S/i);
    if(timing) {
      const prefix=clean(part.slice(0,timing.index)).replace(/[.]+$/, '').trim();
      // Placement instructions are not a description of how the sound feels.
      if(prefix && !/^(?:(?:add|play|use|trigger) (?:this |the )?(?:sound|audio|sfx|music)(?: file)?|plays?|triggers?)$/i.test(prefix)) {
        add(mode==='description' || soundDetail.test(prefix)?'description':'title',prefix);
      }
      add('trigger',part.slice(timing.index));continue;
    }
    if(condition.test(part) || (result.title.length && placement.test(part))) {add('trigger',part);continue;}
    if(/^\(/.test(part) && previous) {add(previous,part);continue;}
    if(mode==='description' || (result.title.length && soundDetail.test(part))) {add('description',part);continue;}
    add('title',part);
  }
  return Object.fromEntries(Object.entries(result).map(([field,parts])=>[field,parts.join(field==='title'?' ':'\n')]));
}
const joinText = (...parts) => [...new Set(parts.filter(Boolean))].join('\n');
export function rowsFromSheet(sheet, mapping = sheet.mapping, choices = {}) {
  const links = importLinks(sheet, mapping);
  const suggestedNames=new Set();
  return sheet.data.map((source, index) => {
    const text = field => cellText(source[mapping[field]]).trim();
    const link = field => cellLink(source[mapping[field]]).trim();
    let name = text('name'), trigger = text('trigger'), description = text('description');
    const isEvent = key(sheet.headers[mapping.trigger]) === 'event';
    const event = isEvent ? splitCueText(trigger) : null;
    const combinedSource = key(sheet.headers[mapping.description]) === 'description trigger when';
    const details = combinedSource ? {description, trigger:''} : splitCueText(description,'description');
    const importWarnings=[];
    if(event) trigger = event.trigger;
    description = joinText(event?.description,details.description);
    trigger = joinText(trigger,details.trigger);
    if(!name && mapping.name < 0 && event?.title) {
      const base=key(event.title).replaceAll(' ','_');
      name=base;let n=2;while(suggestedNames.has(name)) name=`${base}_${n++}`;
      suggestedNames.add(name);importWarnings.push('Sound ID suggested from Event. Review before saving.');
    }
    // Explicit IDs remain unchanged unless their cell also includes a clear timing clause.
    if(name && /\b(?:when|whenever)\s+\S/i.test(name)) {
      const mixed=splitCueText(name);
      if(mixed.title && mixed.trigger) {name=key(mixed.title).replaceAll(' ','_');trigger=joinText(trigger,mixed.trigger);description=joinText(description,mixed.description);importWarnings.push('Separated Sound ID and trigger. Review before saving.');}
    }
    const suggestion = SOUND_SUGGESTIONS.find(r => key(r[0]) === key(name));
    const rawCategory = text('category');
    const category = categoryValue(rawCategory);
    const rawStatus = text('status');
    const status = normalizeStatus(rawStatus);
    const extras = Object.fromEntries(sheet.headers.map((header, i) => [header, safeUrl(cellLink(source[i])) ? cellLink(source[i]) : cellText(source[i])]).filter(([, value], i) => value && !Object.values(mapping).includes(i)));
    if(isEvent && (event.title !== text('trigger') || trigger !== text('trigger'))) extras[sheet.headers[mapping.trigger]] = text('trigger');
    if(description !== text('description')) extras[sheet.headers[mapping.description] || 'Original description'] = text('description');
    let row = { ...emptyCue(), name, category, status, description, trigger, notes: text('notes'), suggestion, audioInput: isLibraryLink(link('audio')) ? '' : link('audio'), audioName: text('audio'), videoInput: link('video'), videoName: text('video'), referenceUrl: link('reference'), libraryReferenceId: text('libraryId'), libraryReferenceUrl: link('libraryUrl') || (isLibraryLink(link('audio')) ? link('audio') : ''), importedCategory: rawCategory, importedStatus: rawStatus, importExtras: extras, sourceRow: index + 1, ...(importWarnings.length?{importWarnings}:{}) };
    row.pendingLinks = [];
    for (const item of links.filter(link => link.index === index)) {
      const choice = choices[item.key] || choices[item.column];
      const type = choices[item.key] || item.type || (['audio','video','reference'].includes(choice) ? choice : '');
      const field = {audio:'audioInput', video:'videoInput', reference:'referenceUrl', library:'libraryReferenceUrl'}[type];
      // Never overwrite another source link. Keep the original available for review.
      if (!field) { row.pendingLinks.push(item); continue; }
      if (row[field] && row[field] !== item.url) {
        if(['audio','video'].includes(type)) {const extra=type==='audio'?'extraAudio':'extraVideo';row[extra]=[...(row[extra] || []),{url:item.url,name:item.name}];}
        else row.pendingLinks.push(item);
        continue;
      }
      row[field] = item.url;
      if (type === 'audio' || type === 'video') row[`${type}Name`] = item.name;
    }
    // Folder URLs stay as sources. A missing extension never implies a folder.
    for(const type of ['audio','video']) {
      const raw=row[`${type}Input`];
      const lines=raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
      const entries=lines.length && lines.every(line=>safeUrl(line,true)) ? lines : (raw.match(/https?:\/\/[^\s<>"']+/gi) || []).map(url=>url.replace(/[.,;)]+$/,''));
      const files=[];
      if(entries.length) for(const url of entries) {
        if(driveLink(url)?.folder) {
          row.mediaSources=[...(row.mediaSources || []),{url,type,name:row[`${type}Name`] || 'Google Drive folder'}];
        } else {
          const actual=mediaType(url.split(/[?#]/)[0]) || (entries.length===1 ? mediaType(row[`${type}Name`]) : '');
          if(actual && actual!==type) {
            row.importWarnings=[...(row.importWarnings || []),`${type==='video'?'Video':'Audio'} column contains ${actual}. Review this source.`];
            row.mediaSources=[...(row.mediaSources || []),{url,type:actual,name:row[`${type}Name`] || 'Check media type'}];
          } else files.push({url,name:entries.length===1 ? row[`${type}Name`] : ''});
        }
      }
      else if(safeUrl(raw,true)) files.push({url:raw,name:row[`${type}Name`] || ''});
      else if(raw) {
        if(/^[^/:<>]+\.(wav|mp3|ogg|m4a|mp4|webm|mov)$/i.test(raw) && !/^(use|same)\s/i.test(raw)) files.push({url:raw,name:raw});
        else row.mediaNotes={...(row.mediaNotes || {}),[type]:raw};
      }
      const extras=(row[type==='audio'?'extraAudio':'extraVideo'] || []).filter(file=>{
        if(!driveLink(file.url)?.folder)return true;
        row.mediaSources=[...(row.mediaSources || []),{url:file.url,type,name:file.name || 'Google Drive folder'}];return false;
      });
      row=setRowFiles(row,type,[...files,...extras]);
    }
    return row;
  });
}
export function rowErrors(row, rows, {allowUnnamed = false} = {}) {
  const errors = {};
  if (row.pendingLinks?.length) errors.importLinks = 'Choose where the unassigned links belong above.';
  if (!row.name.trim() && !allowUnnamed) errors.name = 'Enter a Sound ID.';
  else if (row.name.trim() && (rows.filter(r => key(r.name) === key(row.name)).length > 1)) errors.name = 'Use a unique Sound ID.';
  if (row.category && !CATEGORIES.includes(row.category)) errors.category = 'Choose a category.';
  if (row.status && !STATUSES.includes(row.status)) errors.status = 'Choose a current status.';
  for (const field of ['audioInput', 'videoInput']) {
    const value = row[field]?.trim();
    if (value && !safeUrl(value, true) && !/^[^/:<>]+\.(wav|mp3|ogg|m4a|mp4|webm|mov)$/i.test(value)) errors[field] = 'Use an http/https link or a media filename.';
  }
  for (const field of ['referenceUrl', 'libraryReferenceUrl']) if (row[field] && !safeUrl(row[field])) errors[field] = 'Use an http/https reference link.';
  for(const type of ['audio','video']) if(rowFiles(row,type).some(file=>!file.assetId && !safeUrl(file.url,true) && !/^[^/:<>]+\.(wav|mp3|ogg|m4a|mp4|webm|mov)$/i.test(file.url))) errors[`${type}Input`]='Use a valid link or media filename.';
  return errors;
}
// Keep editable input separate from the saved viewer until a complete list is saved.
export function rowsForGame(game, assets = []) {
  return game.cues.map(cue => ({
    ...structuredClone(cue),
    audioInput: cue.audioReference || '',
    audioName: assets.find(asset => asset.id === cue.assetId)?.name || '',
    existingAssetId: cue.assetId || null,
    videoInput: cue.videoUrl || cue.videoReference || '',
    ...(cue.extraAudioIds?.length ? {extraAudio:cue.extraAudioIds.map(id=>{const a=assets.find(a=>a.id===id);return {assetId:id,url:a?.audioUrl || '',name:a?.name || ''};})}:{}),
    ...(cue.extraVideos?.length ? {extraVideo:cue.extraVideos.map(v=>({...v}))}:{}),
  }));
}
function cueListSignature(cues) {
  const auditKeys = new Set(['createdAt','createdBy','updatedAt','updatedBy','videoAudit','statusHistory','audit']);
  const content = value => Array.isArray(value) ? value.map(content) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key=>!auditKeys.has(key)).map(key=>[key,content(value[key])])) : value;
  return JSON.stringify(content(cues));
}
export function saveWorkingDraft(game, input) {
  return {
    ...(game || {id:crypto.randomUUID(), externalGameId:'', cues:[]}),
    name: game?.name || input.name.trim() || 'Untitled game',
    iconUrl: game?.iconUrl || input.iconUrl || '',
    workingDraft: structuredClone({...input, baseCues:game?.workingDraft?.baseCues ?? game?.cues ?? []}),
  };
}
export function createGameFromRows(name, externalGameId, rows, existingAssets = [], existingGame = null, specStatus = null) {
  const isDraft = specStatus === 'draft';
  if (!name.trim()) throw Error('Enter a game title.');
  rows = rows.filter(hasDraftContent);
  if (!rows.length && !isDraft) throw Error('Add at least one sound cue before saving as Final.');
  if (!isDraft && rows.some(row=>!row.name.trim())) throw Error('Enter a Sound ID for each filled row before saving as Final, or save as draft.');
  if (rows.some(row => Object.keys(rowErrors(row, rows, {allowUnnamed:isDraft})).length)) throw Error('Check the highlighted fields before saving.');
  if (existingGame?.workingDraft && cueListSignature(existingGame.workingDraft.baseCues) !== cueListSignature(existingGame.cues)) throw Error('The saved sound list changed after this draft started. Return to Sound Specs and discard this draft before editing the latest list.');
  const assets = [], id = existingGame?.id || crypto.randomUUID();
  const cues = rows.map(row => {
    const { audioInput, videoInput, audioName, existingAssetId, extraAudio, extraVideo, importedCategory, importedStatus, templateFilled, sourceRow, suggestion, pendingLinks, importWarnings, ...cue } = row;
    if (importedStatus && normalizeStatus(importedStatus) === cue.status && importedStatus !== cue.status) cue.statusBeforeSimplification = importedStatus;
    const rawAudio = audioInput?.trim() || '';
    const audio = isLibraryLink(rawAudio) ? '' : rawAudio, video = videoInput?.trim() || '';
    if (isLibraryLink(rawAudio)) cue.libraryReferenceUrl = rawAudio;
    cue.name = cue.name.trim();
    cue.status = cue.status || 'Open';
    cue.audioReference = audio && !safeUrl(audio, true) ? audio : '';
    cue.videoReference = video && !safeUrl(video, true) ? video : '';
    cue.videoUrl = safeUrl(video, true) ? video : '';
    cue.videoName = cue.videoUrl ? row.videoName || row.name + ' video' : '';
    if (existingAssetId && !existingAssets.some(a=>a.id===existingAssetId)) throw Error('The selected audio file is no longer available. Choose another file.');
    cue.assetId = existingAssetId || null;
    if (!existingAssetId && audio && safeUrl(audio, true)) {
      let asset = [...existingAssets, ...assets].find(a => a.audioUrl === audio);
      if (!asset) {
        const filename = (() => {try { return decodeURIComponent(new URL(audio, 'https://local.invalid').pathname.split('/').pop()) || cue.name; } catch {return cue.name;} })();
        asset = { id: crypto.randomUUID(), name: audioName && audioName !== audio ? audioName : /\.(wav|mp3|ogg|m4a)$/i.test(filename) ? filename : cue.name, audioUrl: audio, category: cue.category, tags: [], sourceGame: name.trim(), libraryId: '', libraryUrl: '', origin: 'import' };
        assets.push(asset);
      }
      cue.assetId = asset.id;
    }
    const extraIds=[];
    for(const file of extraAudio || []) {
      if(file.assetId) {if(!existingAssets.some(a=>a.id===file.assetId))throw Error('An attached audio file is missing.');extraIds.push(file.assetId);continue;}
      if(!safeUrl(file.url,true) || driveLink(file.url)?.folder)throw Error('Choose individual audio files from the folder before attaching them.');
      let asset=[...existingAssets,...assets].find(a=>a.audioUrl===file.url);
      if(!asset) {asset={id:crypto.randomUUID(),name:file.name || cue.name,audioUrl:file.url,category:cue.category,tags:[],sourceGame:name.trim(),libraryId:'',libraryUrl:'',origin:'import'};assets.push(asset);}
      extraIds.push(asset.id);
    }
    Object.assign(cue,setCueAudio(cue,[cue.assetId,...extraIds]));
    if(!extraIds.length) delete cue.extraAudioIds;
    if(extraVideo?.length) cue.extraVideos=extraVideo.map(file=>({...existingGame?.cues.find(c=>c.id===cue.id)?.extraVideos?.find(v=>v.url===file.url),url:file.url,name:file.name || cue.name+' video'}));
    else delete cue.extraVideos;
    const prior = existingGame?.cues.find(saved => saved.id === cue.id);
    if (prior && 'sourceRow' in prior) cue.sourceRow = prior.sourceRow;
    for (const field of ['audioReference', 'videoReference']) if (prior && !(field in prior) && !cue[field]) delete cue[field];
    return prior ? {...prior, ...cue} : cue;
  });
  const {workingDraft, ...baseGame} = existingGame || {};
  return { game: { ...baseGame, id, name: name.trim(), externalGameId: externalGameId.trim(), cues, ...(specStatus ? {specStatus} : {}) }, assets };
}
