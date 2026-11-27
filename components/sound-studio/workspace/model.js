import {cueAudioIds,cueVideos,setCueAudio,setCueVideos} from './cue-media.js';
export const STATUSES = ["Open", "Ready for implementation", "Implemented", "Blocked"];
export const LEGACY_STATUSES = ["In review", "Canceled", "Approved", "Waiting for animation", "Need adjustment", "To Be Implemented", "Sound Updated"];
export function normalizeStatus(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return STATUSES.find(status => status.toLowerCase() === key) || {
    'in review':'Open', draft:'Open', reviewed:'Open', backlog:'Open',
    'need adjustment':'Open', 'sound updated':'Open',
    approved:'Ready for implementation', 'to be implemented':'Ready for implementation',
    canceled:'Blocked', cancelled:'Blocked', 'waiting for animation':'Blocked', block:'Blocked',
  }[key] || '';
}
export const CATEGORIES = [
  "UI",
  "Gameplay",
  "Reward",
  "Booster",
  "Level state",
  "Music",
  "Menu",
];
export function validateMediaFile(file, mediaType) {
  const video = mediaType === "video";
  const extension = video ? /\.(mp4|webm|mov)$/i : /\.(wav|mp3|ogg|m4a)$/i;
  if (!extension.test(file.name) || file.size > 50 * 1024 * 1024)
    throw Error(video
      ? "Choose an MP4, WEBM or MOV video under 50 MB."
      : "Choose a WAV, MP3, OGG or M4A audio file under 50 MB.");
}
export function validateGameIconFile(file) {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) || !file.size || file.size > 2 * 1024 * 1024)
    throw Error('Choose a PNG, JPG or WEBP image under 2 MB.');
}
export function normalizeLibraryReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Paste the complete Copy for AI content from Cerberator.');
  const text = (key, required = false) => {
    const v = value[key];
    if (v == null && !required) return '';
    if (typeof v !== 'string' || v.length > 8000 || (required && !v.trim())) throw Error(`The library reference needs a valid ${key}.`);
    return v.trim();
  };
  const id = text('id', true), title = text('title', true);
  if (!/^snd_[a-z0-9_-]+$/i.test(id) || id.length > 200) throw Error('The library sound ID is not valid. Copy the sound again from Cerberator.');
  const mediaUrl = key => {
    const raw = text(key);
    if (!raw) return '';
    let url;
    try { url = new URL(raw); } catch { throw Error(`The library ${key} is not a valid link.`); }
    if (url.protocol !== 'https:' || url.username || url.password || !['woylie-quoll-galah.vercel.app','cerberator.tripledotstudios.com'].includes(url.hostname))
      throw Error(`The library ${key} must be a Cerberator HTTPS link.`);
    return url.href;
  };
  const duration = value.duration_sec;
  if (duration != null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)) throw Error('The library duration is not valid.');
  if (value.tags != null && (!Array.isArray(value.tags) || value.tags.length > 100)) throw Error('The library tags are not valid.');
  const tags = (value.tags || []).map(tag => {
    if (!tag || typeof tag.id !== 'string' || !tag.id.trim() || tag.id.length > 200) throw Error('The library tags are not valid.');
    return {id:tag.id.trim()};
  });
  return {id, title, game:text('game'), category:text('category'), tags, duration_sec:duration ?? null,
    metadata_url:mediaUrl('metadata_url'), audio_url:mediaUrl('audio_url'), preview_url:mediaUrl('preview_url')};
}
export function libraryCatalog(references = [], base = []) {
  const byId = new Map();
  for (const value of [...base,...references]) {
    if (!value) continue;
    try { const ref = normalizeLibraryReference(value); byId.set(ref.id,ref); } catch { /* Ignore invalid catalog entries. */ }
  }
  return [...byId.values()];
}
export function filterLibraryCatalog(catalog, query = '', category = '', game = '') {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.filter(ref => (!category || ref.category === category) && (!game || ref.game === game) && terms.every(term =>
    [ref.title,ref.id,ref.game,ref.category,...ref.tags.map(tag=>tag.id)].join(' ').toLowerCase().includes(term)));
}
export function parseLibraryReference(input) {
  if (typeof input !== 'string' || input.length > 100000) throw Error('Paste Copy for AI content under 100 KB.');
  // Accept copied JSON with an optional Markdown code fence; never execute it.
  const raw = input.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let value;
  try { value = JSON.parse(raw); } catch { throw Error('This is not valid JSON. Paste the complete Copy for AI content, including the opening and closing braces.'); }
  return normalizeLibraryReference(value);
}
// Combine legacy fields for display without rewriting untouched cues or their audit history.
export function cueDescription(cue) {
  return [...new Set([cue.description || '', cue.trigger || ''].filter(value => value.trim()))].join('\n');
}
export const emptyCue = () => ({
  id: crypto.randomUUID(),
  name: "new_sound",
  category: "",
  status: "Open",
  trigger: "",
  description: "",
  notes: "",
  referenceUrl: "",
  videoUrl: "",
  videoName: "",
  libraryReferenceId: "",
  libraryReferenceUrl: "",
  assetId: null,
});
// Upgrade older local lists without deleting attachments or guessing approval.
export function migrateState(input) {
  const s = structuredClone(input);
  if (![1, 2].includes(s?.schemaVersion)) return s;
  const oldVersion = s.schemaVersion;
  for (const g of s.games || [])
    for (const c of g.cues || []) {
      const a = s.assets?.find((a) => a.id === c.assetId);
      if (oldVersion === 1)
        c.status =
          { Draft: "In review", Reviewed: "In review", Cancelled: "Canceled" }[
            c.status
          ] || c.status;
      c.videoName = c.videoName || "";
      c.libraryReferenceId = c.libraryReferenceId || a?.libraryId || "";
      c.libraryReferenceUrl = c.libraryReferenceUrl || a?.libraryUrl || "";
    }
  for (const g of s.games || []) {
    g.createdAt ??= null;
    g.createdBy ??= null;
    g.updatedBy ??= null;
  }
  s.schemaVersion = 3;
  return s;
}
export function validateState(s) {
  const text = (v) => typeof v === "string";
  if (
    !s ||
    s.schemaVersion !== 3 ||
    !Number.isInteger(s.revision) ||
    s.revision < 0 ||
    !Array.isArray(s.games) ||
    !Array.isArray(s.assets)
  )
    throw Error("Unsupported backup format or missing games.");
  const ids = new Set();
  for (const g of s.games) {
    if (
      !g ||
      !text(g.id) ||
      !g.id ||
      ids.has(g.id) ||
      !text(g.name) ||
      !g.name.trim() ||
      !Array.isArray(g.cues)
    )
      throw Error("Invalid game.");
    if (g.iconUrl && (typeof g.iconUrl !== 'string' || g.iconUrl.length > 2800000 || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(g.iconUrl)))
      throw Error('Invalid game icon. Upload a PNG, JPG or WEBP image.');
    if (g.specStatus !== undefined && !['draft','final'].includes(g.specStatus)) throw Error('Invalid spec status.');
    if (g.workingDraft !== undefined) {
      const d = g.workingDraft;
      if (!d || !text(d.name) || !text(d.iconUrl) || !Array.isArray(d.rows) || d.rows.length > 500 || !Array.isArray(d.baseCues)) throw Error('Invalid saved draft.');
      const rowIds = new Set();
      for (const row of d.rows) {
        if (!row || !text(row.id) || !row.id || rowIds.has(row.id) || !['name','category','description','trigger','status','audioInput','videoInput'].every(key=>text(row[key]))) throw Error('Invalid draft row.');
        rowIds.add(row.id);
        if (row.libraryReference) normalizeLibraryReference(row.libraryReference);
        validateMediaCollections(row,true);
      }
      if (d.iconUrl && (d.iconUrl.length > 2800000 || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(d.iconUrl))) throw Error('Invalid draft game icon.');
    }
    ids.add(g.id);
    if (g.specStatus === "final" && !g.cues.length) throw Error("Add at least one sound cue before saving as Final.");
    const names = new Set(),
      cids = new Set();
    for (const c of g.cues) {
      if (
        !c ||
        !text(c.id) ||
        !c.id ||
        cids.has(c.id) ||
        !text(c.name) ||
        (!c.name.trim() && g.specStatus !== "draft") ||
        (c.name.trim() && names.has(c.name.trim().toLowerCase()))
      )
        throw Error("Each cue needs a unique name and ID.");
      if (
        ![
          c.category,
          c.status,
          c.trigger,
          c.description,
          c.referenceUrl,
          c.videoUrl,
          c.videoName,
          c.libraryReferenceId,
          c.libraryReferenceUrl,
        ].every(text)
      )
        throw Error("Invalid sound cue fields.");
      if (LEGACY_STATUSES.includes(c.status)) {
        c.statusBeforeSimplification ??= c.status;
        c.status = normalizeStatus(c.status);
      }
      if ((c.category !== "" && !CATEGORIES.includes(c.category)) || !STATUSES.includes(c.status))
        throw Error("Unknown sound type or status.");
      if (c.statusHistory !== undefined && (!Array.isArray(c.statusHistory) ||
          c.statusHistory.some(h => !h || ![...STATUSES,...LEGACY_STATUSES].includes(h.from) ||
            ![...STATUSES,...LEGACY_STATUSES].includes(h.to) || !text(h.by) || !text(h.at) ||
            !Number.isFinite(Date.parse(h.at)))))
        throw Error("Invalid status history.");
      if (c.libraryReference != null) {
        c.libraryReference = normalizeLibraryReference(c.libraryReference);
        if (c.libraryReferenceId !== c.libraryReference.id) throw Error('The library reference ID does not match its sound details.');
      }
      names.add(c.name.trim().toLowerCase());
      cids.add(c.id);
      validateMediaCollections(c);
      for (const key of ["referenceUrl", "videoUrl", "libraryReferenceUrl"])
        if (c[key] && !safeUrl(c[key], key === "videoUrl"))
          throw Error("Use a valid http or https media link.");
    }
  }
  const aids = new Set();
  if (s.videos !== undefined && !Array.isArray(s.videos))
    throw Error("Invalid video files.");
  const vids = new Set();
  for (const v of s.videos || []) {
    if (!v || !text(v.id) || !v.id || vids.has(v.id) ||
        !text(v.name) || !v.name.trim() || !safeUrl(v.videoUrl, true) ||
        (v.videoUrl.startsWith("data:") && !v.videoUrl.startsWith("data:video/")) ||
        !Array.isArray(v.tags) || !v.tags.every(text) ||
        !text(v.sourceGame) || v.category !== "Video")
      throw Error("Invalid video file.");
    vids.add(v.id);
  }
  for (const a of s.assets) {
    if (
      !a ||
      !text(a.id) ||
      !a.id ||
      aids.has(a.id) ||
      !text(a.name) ||
      !a.name.trim() ||
      !safeUrl(a.audioUrl, true) ||
      !Array.isArray(a.tags) ||
      !a.tags.every(text) ||
      !text(a.sourceGame) ||
      !text(a.libraryId) ||
      !text(a.libraryUrl) ||
      (a.category !== "" && !CATEGORIES.includes(a.category))
    )
      throw Error("Invalid audio asset.");
    aids.add(a.id);
    if (a.libraryUrl && !safeUrl(a.libraryUrl))
      throw Error("Invalid library link.");
  }
  for (const g of s.games)
    for (const c of g.cues)
      if (cueAudioIds(c).some(id=>!aids.has(id)))
        throw Error("Attached audio asset is missing.");
  return s;
}
export function isEmbeddedMedia(value) {
  if (typeof value !== "string") return false;
  const prefix = value.match(/^data:(audio\/(wav|mpeg|ogg|mp4)|video\/(mp4|webm|quicktime));base64,/);
  return Boolean(prefix) && value.length > prefix[0].length && !/[^A-Za-z0-9+/=]/.test(value.slice(prefix[0].length));
}
function validateMediaCollections(c,draft=false) {
  if(c.notes !== undefined && typeof c.notes!=='string')throw Error('Invalid cue notes.');
  if(c.extraAudioIds !== undefined && (!Array.isArray(c.extraAudioIds) || c.extraAudioIds.length>100 || c.extraAudioIds.some(id=>typeof id!=='string' || !id)))throw Error('Invalid audio attachments.');
  for(const key of draft?['extraAudio','extraVideo']:['extraVideos']) {
    if(c[key] !== undefined && (!Array.isArray(c[key]) || c[key].length>100 || c[key].some(file=>!file || typeof file.name!=='string' || !(safeUrl(file.url,true) || (draft && typeof file.assetId==='string' && file.assetId)))))throw Error('Invalid media attachments.');
  }
  if(c.mediaSources !== undefined && (!Array.isArray(c.mediaSources) || c.mediaSources.length>100 || c.mediaSources.some(source=>!source || !['audio','video'].includes(source.type) || typeof source.name!=='string' || !safeUrl(source.url))))throw Error('Invalid media source.');
  if(c.mediaNotes !== undefined && (!c.mediaNotes || typeof c.mediaNotes!=='object' || Array.isArray(c.mediaNotes) || Object.values(c.mediaNotes).some(value=>typeof value!=='string')))throw Error('Invalid media notes.');
}
export function safeUrl(value, local = false) {
  if (local && /^\/api\/sound-studio\/files\/[a-f0-9-]{36}\.(wav|mp3|ogg|m4a|mp4|webm|mov)$/.test(value)) return true;
  if (local && isEmbeddedMedia(value)) return true;
  if (local && /^\/(?:sound-studio\/)?(media|uploads)\/[a-zA-Z0-9_.-]+$/.test(value)) return true;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function videoKind(url) {
  if (/^\/api\/sound-studio\/files\/[a-f0-9-]{36}\.(mp4|webm|mov)$/.test(url)) return {kind:"video",url};
  if (isEmbeddedMedia(url) && url.startsWith("data:video/")) return {kind:"video",url};
  if (/^\/(?:sound-studio\/)?(media|uploads)\/[a-zA-Z0-9_.-]+\.(mp4|webm|mov)$/i.test(url))
    return { kind: "video", url };
  try {
    const u = new URL(url);
    if (u.hostname === "drive.google.com") {
      const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1];
      if (id)
        return {
          kind: "embed",
          url: `https://drive.google.com/file/d/${id}/preview`,
        };
    }
    if (["www.youtube.com", "youtube.com", "youtu.be"].includes(u.hostname)) {
      const id =
        u.hostname === "youtu.be"
          ? u.pathname.slice(1)
          : u.searchParams.get("v");
      if (/^[\w-]{11}$/.test(id || ""))
        return {
          kind: "embed",
          url: `https://www.youtube-nocookie.com/embed/${id}`,
        };
    }
    if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return { kind: "video", url };
  } catch {}
  return { kind: "link", url };
}

export function stampAudit(
  next,
  previous,
  actor,
  now = new Date().toISOString(),
) {
  const auditKeys=new Set(['createdAt','createdBy','updatedAt','updatedBy','videoAudit','statusHistory','audit']);
  const stripAudit=value=>Array.isArray(value)?value.map(stripAudit):value && typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!auditKeys.has(key)).map(([key,item])=>[key,stripAudit(item)])):value;
  const content=g=>JSON.stringify(stripAudit(g));
  const name =
    typeof actor === "string" && actor.trim()
      ? actor.trim().slice(0, 80)
      : "Local editor";
  const stamp = (item, old) => {
    const changed = !old || content(item) !== content(old);
    return {
      createdAt: old ? old.createdAt || null : now,
      createdBy: old ? old.createdBy || null : name,
      updatedAt: changed ? now : old.updatedAt || null,
      updatedBy: changed ? name : old.updatedBy || null,
    };
  };
  const priorVideos = previous.games.flatMap(g=>g.cues.flatMap(c=>cueVideos(c).map(v=>({videoUrl:v.url,videoName:v.name,videoAudit:v.audit}))));
  return {
    ...next,
    ...(next.videos ? {
      videos: next.videos.map((v) => ({
        ...v,
        ...stamp(v, previous.videos?.find((old) => old.id === v.id)),
      })),
    } : {}),
    assets: next.assets.map((a) => ({
      ...a,
      ...stamp(
        a,
        previous.assets.find((x) => x.id === a.id),
      ),
    })),
    games: next.games.map((g) => {
      const old = previous.games.find((x) => x.id === g.id);
      const changed = !old || content(g) !== content(old);
      return {
        ...g,
        cues: g.cues.map((c) => {
          const priorCue = old?.cues.find((prior) => prior.id === c.id);
          const history = priorCue?.statusHistory || [];
          const statusAudit = priorCue && priorCue.status !== c.status
            ? {statusHistory: [...history, {from: priorCue.status, to: c.status, by: name, at: now}]}
            : (history.length ? {statusHistory: history} : {});
          const {statusHistory: suppliedHistory, ...cueContent} = c;
          if(c.extraVideos?.length) cueContent.extraVideos=c.extraVideos.map(file=>{
            const oldFile=priorVideos.find(v=>v.videoUrl===file.url);
            return {...file,audit:stamp({videoUrl:file.url,videoName:file.name},oldFile?{videoUrl:oldFile.videoUrl,videoName:oldFile.videoName,...oldFile.videoAudit}:undefined)};
          });
          // Status has its own audit trail; it is not a cue-content edit.
          const withoutStatus = ({status, ...details}) => details;
          const cueAudit = stamp(withoutStatus(c), priorCue && withoutStatus(priorCue));
          if (!c.videoUrl) {
            const { videoAudit, ...rest } = cueContent;
            return { ...rest, ...cueAudit, ...statusAudit };
          }
          const prior = priorVideos.find((v) => v.videoUrl === c.videoUrl);
          const priorRecord = prior
            ? {
                videoUrl: prior.videoUrl,
                videoName: prior.videoName || "",
                ...prior.videoAudit,
              }
            : undefined;
          return {
            ...cueContent,
            ...cueAudit,
            ...statusAudit,
            videoAudit: stamp(
              { videoUrl: c.videoUrl, videoName: c.videoName || "" },
              priorRecord,
            ),
          };
        }),
        createdAt: old ? old.createdAt || null : now,
        createdBy: old ? old.createdBy || null : name,
        updatedAt: changed ? now : old.updatedAt,
        updatedBy: changed ? name : old.updatedBy || null,
      };
    }),
  };
}

// Remove a demo file and its attachments, without deleting cues or library references.
export function fileUsages(state, file, type) {
  return state.games.flatMap(game => game.cues.filter(cue => type === 'video' ? cueVideos(cue).some(v=>v.url===file.videoUrl) : cueAudioIds(cue).includes(file.id)).map(cue => ({game:game.name,cue:cue.name})));
}
export function removeUploadedFile(state, file, type) {
  if (!['audio','video'].includes(type)) throw Error('Choose an audio or video file.');
  if (!file || !(type === 'video' ? file.videoUrl : file.id)) throw Error('File not found.');
  const next = structuredClone(state);
  if (type === 'audio') next.assets = next.assets.filter(asset => asset.id !== file.id);
  else next.videos = (next.videos || []).filter(video => video.videoUrl !== file.videoUrl);
  for (const game of next.games) for (const cue of game.cues) {
    if(type==='audio' && cueAudioIds(cue).includes(file.id)) {
      const updated=setCueAudio(cue,cueAudioIds(cue).filter(id=>id!==file.id));delete cue.extraAudioIds;Object.assign(cue,updated);cue.audioReference='';
    }
    if(type==='video' && cueVideos(cue).some(v=>v.url===file.videoUrl)) {
      const updated=setCueVideos(cue,cueVideos(cue).filter(v=>v.url!==file.videoUrl));delete cue.extraVideos;delete cue.videoAudit;Object.assign(cue,updated);cue.videoReference='';
    }
    if (type === 'audio' && cue.assetId === file.id) {cue.assetId = null;cue.audioReference = '';}
    if (type === 'video' && cue.videoUrl === file.videoUrl) {
      cue.videoUrl = '';cue.videoName = '';cue.videoReference = '';delete cue.videoAudit;
    }
  }
  return validateState(next);
}
