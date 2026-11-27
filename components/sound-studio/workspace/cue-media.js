// Keep the original primary fields compatible with existing demo specs/backups.
export function cueAudioIds(cue) {
  return [...new Set([cue?.assetId, ...(cue?.extraAudioIds || [])].filter(Boolean))];
}
export function cueVideos(cue) {
  return [...new Map([
    ...(cue?.videoUrl ? [{url:cue.videoUrl,name:cue.videoName || '',audit:cue.videoAudit}] : []),
    ...(cue?.extraVideos || []),
  ].map(file=>[file.url,file])).values()];
}
export function setCueAudio(cue, ids) {
  const [assetId = null,...extraAudioIds] = [...new Set(ids.filter(Boolean))];
  const {extraAudioIds:old,...rest} = cue;
  return {...rest,assetId,...(extraAudioIds.length ? {extraAudioIds} : {})};
}
export function setCueVideos(cue, files) {
  const [first,...extraVideos] = uniqueFiles(files);
  const {extraVideos:old,videoAudit,...rest} = cue;
  return {...rest,videoUrl:first?.url || '',videoName:first?.name || '',
    ...(first?.audit ? {videoAudit:first.audit} : {}),...(extraVideos.length ? {extraVideos} : {})};
}
export function uniqueFiles(files) {
  const seen = new Set();
  return files.filter(file=>{
    const key=file.assetId || file.url;
    if(!key || seen.has(key)) return false;
    seen.add(key);return true;
  });
}
export function rowFiles(row,type,assets=[]) {
  const asset=type==='audio' && assets.find(a=>a.id===row.existingAssetId);
  const primary=asset ? {assetId:asset.id,url:asset.audioUrl,name:asset.name} : row[`${type}Input`] ? {url:row[`${type}Input`],name:row[`${type}Name`] || '',...(type==='video' && row.videoAudit?{audit:row.videoAudit}:{})} : null;
  return uniqueFiles([...(primary?[primary]:[]),...(row[type==='audio'?'extraAudio':'extraVideo'] || [])]);
}
export function setRowFiles(row,type,files) {
  const [first,...extra]=uniqueFiles(files);
  return {...row,[`${type}Input`]:first?.assetId ? '' : first?.url || '',[`${type}Name`]:first?.name || '',
    ...(type==='audio'?{existingAssetId:first?.assetId || null}:{}),[type==='audio'?'extraAudio':'extraVideo']:extra};
}
export function driveLink(value) {
  try {
    const u=new URL(value);
    if(!['drive.google.com','docs.google.com'].includes(u.hostname) || u.protocol!=='https:') return null;
    const folder=u.pathname.match(/\/folders\/([\w-]+)/)?.[1];
    const id=folder || u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || u.searchParams.get('id');
    if(!id || !/^[\w-]+$/.test(id)) return null;
    return {id,folder:Boolean(folder),resourceKey:u.searchParams.get('resourcekey') || ''};
  } catch {return null;}
}
export function mediaType(name='',mime='') {
  if(/\.(wav|mp3|ogg|m4a)$/i.test(name) || /^audio\//.test(mime)) return 'audio';
  if(/\.(mp4|webm|mov)$/i.test(name) || /^video\//.test(mime)) return 'video';
  return '';
}
