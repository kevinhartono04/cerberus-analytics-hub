import { readFileSync } from 'node:fs';
import { validateCatalogSnapshot } from '../components/sound-studio/workspace/library-catalog.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseCsv, selectSoundSheet, prepareSheet, rowsFromSheet, readSpreadsheet, rowErrors, createGameFromRows, templateRows, blankDraftRow, SOUND_SUGGESTIONS, audioLinkChange, rowsForGame, saveWorkingDraft} from '../components/sound-studio/workspace/new-game.js';
import {validateState, cueDescription, stampAudit, validateGameIconFile, parseLibraryReference, libraryCatalog, filterLibraryCatalog} from '../components/sound-studio/workspace/model.js';
const seed=JSON.parse(readFileSync(new URL('./fixtures/sound-studio-demo-state.json',import.meta.url),'utf8'));
import {cueAudioIds,cueVideos,driveLink} from '../components/sound-studio/workspace/cue-media.js';
import {removeUploadedFile,fileUsages} from '../components/sound-studio/workspace/model.js';
test('audio tracker headers, merged types, formulas and folder sources import without treating folders as files',async()=>{
  const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('SFX List');
  s.addRow(['Audio tracker']);s.addRow(['No.','Audio Type','Event','Description','Video Preview','Final File','Status']);
  s.addRow([1,'BGM','Lobby','',{text:'Preview',hyperlink:'https://drive.google.com/file/d/video/view'},{text:'Music variations',hyperlink:'https://drive.google.com/drive/folders/folder'},'Implemented']);
  s.addRow([2,'','Lobby','',{text:'wrong.wav',hyperlink:'https://drive.google.com/file/d/audio/view'},{formula:'HYPERLINK("https://drive.google.com/file/d/individual/view","No extension")',result:'No extension'},'To Be Implemented']);
  s.mergeCells('B3:B4');
  s.addRow([3,'SFX – UI','Tap','','','Use same sound as UI_Button','Implemented']);
  s.addRow([4,'SFX – Core Gameplay','Deal','','https://example.com/a.mp4\nhttps://example.com/b.mp4','https://example.com/a.wav\nhttps://example.com/b.wav','Implemented']);
  const bytes=await wb.xlsx.writeBuffer();const p=prepareSheet((await readSpreadsheet(new File([bytes],'tracker.xlsx')))[0]);
  const rows=rowsFromSheet(p);
  assert.deepEqual(rows.map(r=>r.name),['lobby','lobby_2','tap','deal']);
  assert.deepEqual(rows.map(r=>r.category),['Music','Music','UI','Gameplay']);
  assert.equal(rows[0].audioInput,'');assert.equal(rows[0].mediaSources[0].url,'https://drive.google.com/drive/folders/folder');
  assert.equal(rows[1].audioInput,'https://drive.google.com/file/d/individual/view');
  assert.equal(rows[1].videoInput,'');assert.equal(rows[1].mediaSources[0].type,'audio');
  assert.equal(rows[2].audioInput,'');assert.equal(rows[2].mediaNotes.audio,'Use same sound as UI_Button');
  assert.equal(rows[3].extraAudio.length,1);assert.equal(rows[3].extraVideo.length,1);
  assert.equal(driveLink('https://drive.google.com/file/d/individual/view').folder,false);
  assert.equal(driveLink('https://drive.google.com/drive/folders/folder').folder,true);
  assert.equal(driveLink('https://drive.google.com.evil.example/drive/folders/folder'),null);
});

test('multiple audio and videos survive save, draft, backup, edit and deletion with audit intact',()=>{
  const row={...blankDraftRow(),name:'variations',category:'UI',status:'Open',audioInput:'/media/one.wav',audioName:'one.wav',extraAudio:[{url:'/media/two.wav',name:'two.wav'}],videoInput:'/media/one.mp4',videoName:'one.mp4',extraVideo:[{url:'/media/two.mp4',name:'two.mp4'}]};
  const result=createGameFromRows('Variations','',[row]);
  const next=stampAudit({...seed,games:[...seed.games,result.game],assets:[...seed.assets,...result.assets]},seed,'Tester','2026-11-23T01:00:00Z');
  const saved=validateState(JSON.parse(JSON.stringify(next))),game=saved.games.at(-1),cue=game.cues[0];
  assert.equal(cueAudioIds(cue).length,2);assert.equal(cueVideos(cue).length,2);
  assert.equal(cue.extraVideos[0].audit.createdBy,'Tester');
  const rows=rowsForGame(game,saved.assets);
  const draft=saveWorkingDraft(game,{name:game.name,iconUrl:'',rows});
  const edited=createGameFromRows(game.name,'',draft.workingDraft.rows,saved.assets,draft);
  assert.deepEqual(edited.game.cues,game.cues);
  const untouched=stampAudit({...saved,games:saved.games.map(g=>g.id===game.id?edited.game:g)},saved,'Second tester','2026-11-23T02:00:00Z');
  assert.equal(untouched.games.at(-1).cues[0].updatedAt,cue.updatedAt);
  const audio=saved.assets.find(a=>a.id===cue.assetId);
  assert.equal(fileUsages(saved,audio,'audio').length,1);
  const removed=removeUploadedFile(saved,audio,'audio');
  assert.equal(cueAudioIds(removed.games.at(-1).cues[0]).length,1);
  assert.equal(removed.games.at(-1).cues[0].assetId,cue.extraAudioIds[0]);
  const videoRemoved=removeUploadedFile(removed,{videoUrl:cue.videoUrl},'video');
  assert.equal(videoRemoved.games.at(-1).cues[0].videoUrl,'/media/two.mp4');
  assert.equal(videoRemoved.games.at(-1).cues[0].videoAudit.createdBy,'Tester');
  const broken=structuredClone(saved);broken.games.at(-1).cues[0].extraAudioIds=['missing'];
  assert.throws(()=>validateState(broken),/missing/);
  broken.games.at(-1).cues[0].extraAudioIds=[];broken.games.at(-1).cues[0].extraVideos=[{name:'unsafe',url:'javascript:alert(1)'}];
  assert.throws(()=>validateState(broken),/media attachments/);
});

test('multiline events separate suggested IDs and triggers while optional notes survive save and edit',()=>{
  const sheet=prepareSheet({name:'Sounds',rows:[['Event','Audio Type','Description','Status','Notes'],
    ['Change & Take - Card Choose\n     When players choose a card after being scattered','SFX – Core Gameplay','','Implemented','Use a softer variation.'],
    ['Change & Take - Card Fly Down\n     When Change & Take card flying down','SFX – Core Gameplay','','Implemented',''],
    ['Change & Take - Card Fly Up\n     When Change & Take card flying up','SFX – Core Gameplay','','Implemented','']]});
  const rows=rowsFromSheet(sheet);
  assert.deepEqual(rows.map(r=>r.name),['change_take_card_choose','change_take_card_fly_down','change_take_card_fly_up']);
  assert.equal(rows[0].trigger,'When players choose a card after being scattered');
  assert.equal(rows[0].description,'');assert.equal(rows[0].notes,'Use a softer variation.');
  assert.ok(rows.every(r=>Object.keys(rowErrors(r,rows)).length===0));
  const {game,assets}=createGameFromRows('Events','',rows);
  const saved=validateState(JSON.parse(JSON.stringify({...seed,games:[...seed.games,game],assets:[...seed.assets,...assets]})));
  const reopened=rowsForGame(saved.games.at(-1),saved.assets);
  assert.equal(reopened[0].notes,rows[0].notes);assert.equal(reopened[0].description,'');
  assert.equal(saveWorkingDraft(game,{name:game.name,iconUrl:'',rows:reopened}).workingDraft.rows[0].notes,rows[0].notes);
  const explicit=rowsFromSheet(prepareSheet({name:'Explicit',rows:[['Sound ID','When to play','Notes'],['custom_id','When it happens','Separate note']]}))[0];
  assert.equal(explicit.name,'custom_id');assert.equal(explicit.trigger,'When it happens');assert.equal(explicit.description,'');
});

test('mixed event text is separated across inline conditions, sub-events and misplaced descriptions',()=>{
  const values=[
    ['Card Deal - When cards are distributed to players','', 'card_deal','When cards are distributed to players',''],
    ['Card Draw — When players draw cards from Take Stack','', 'card_draw','When players draw cards from Take Stack',''],
    ['Special Card, Select & Take\n Players Appearance - when players are available to be selected','','special_card_select_take_players_appearance','when players are available to be selected',''],
    ['Power Card - Deflect\n Shield Appear','','power_card_deflect_shield_appear','',''],
    ['Power Card - Deflect\n Shield Disappear','','power_card_deflect_shield_disappear','',''],
    ['Power Card - Clear by Colour\n Card Scatter - all cards being scattered','','power_card_clear_by_colour_card_scatter','all cards being scattered',''],
    ['Take 2 - Stack +2 appears on top of players profile','','take_2','Stack +2 appears on top of players profile',''],
    ['Booster Dictionary - Card Tooltip Appears','','booster_dictionary_card_tooltip_appears','',''],
    ['Button Click - Short, soft click - When the settings button is pressed','','button_click','When the settings button is pressed','Short, soft click'],
    ['Coin Reward','Short bright reward sparkle. When coins reach the counter','coin_reward','When coins reach the counter','Short bright reward sparkle'],
    ['Deflect Fire','Add this sound when the fire appears during the Deflect animation.','deflect_fire','when the fire appears during the Deflect animation.',''],
    ['Round Complete Combine','When points combine\n(before adding to the total)','round_complete_combine','When points combine\n(before adding to the total)',''],
    ['Soft Click','','soft_click','',''],
    ['Window - After the popup closes','','window','After the popup closes',''],
    ['Menu Music - Description: Calm looping music - Trigger: While the menu is open','','menu_music','While the menu is open','Calm looping music'],
  ];
  const rows=rowsFromSheet(prepareSheet({name:'Sounds',rows:[['Event','Description'],...values.map(v=>v.slice(0,2))]}));
  rows.forEach((r,i)=>assert.deepEqual([r.name,r.trigger,r.description],values[i].slice(2),values[i][0]));
  assert.equal(rows[0].importExtras.Event,values[0][0]);
  assert.equal(rows[10].importExtras.Description,values[10][1]);
  const [explicit]=rowsFromSheet(prepareSheet({name:'Explicit',rows:[['Sound ID','Description','Trigger'],['existing_id','When the menu closes','On opening the menu']]}));
  assert.equal(explicit.name,'existing_id');assert.equal(explicit.trigger,'On opening the menu\nWhen the menu closes');assert.equal(explicit.description,'');
  const [mixed]=rowsFromSheet(prepareSheet({name:'Named',rows:[['Sound name'],['Card Deal - When cards are dealt']]}));
  assert.equal(mixed.name,'card_deal');assert.equal(mixed.trigger,'When cards are dealt');
  const [conditionOnly]=rowsFromSheet(prepareSheet({name:'No title',rows:[['Event'],['When a card appears']]}));
  assert.equal(conditionOnly.name,'');assert.equal(conditionOnly.trigger,'When a card appears');
});

test('CSV handles BOM, quoted commas, newlines, escaped quotes and semicolon delimiters', () => {
  const rows = parseCsv('\uFEFFSound ID,Description,Status\r\nbutton_tap,"Soft, short\n""click""",Approved\r\n');
  assert.deepEqual(rows[1], ['button_tap','Soft, short\n"click"','Approved']);
  assert.deepEqual(parseCsv('Sound ID;Type\ncustom;UI')[1], ['custom','UI']);
  assert.throws(() => parseCsv('Sound ID,Description\nx,"unfinished'), /unclosed/);
});
test('import preserves existing values and leaves missing values as suggestions only', () => {
  const sheet = prepareSheet({name:'Sounds',rows:[['Marble Drop'],['Sound_ID','Type','Description','Placement','Progress','Owner'],['button_tap','UI','My custom click','','Done','Artem'],['custom_cue','Custom','','Tap','Approved','Andre']]});
  const rows = rowsFromSheet(sheet);
  assert.equal(rows[0].description,'My custom click');
  assert.equal(rows[0].trigger,'');
  assert.equal(rows[0].suggestion[3],'Tap a button');
  assert.equal(rows[0].status,'');
  assert.equal(rows[0].importedStatus,'Done');
  assert.equal(rows[0].importExtras.Owner,'Artem');
  assert.equal(rows[1].category,'');
  assert.equal(rowErrors(rows[1],rows).category,undefined);
});
test('duplicate and invalid fields block creation without silently dropping cues', () => {
  const rows = SOUND_SUGGESTIONS.map(([name,category,description,trigger]) => ({...blankDraftRow(),name,category,description,trigger,status:'Ready for implementation'}));
  rows[1].name = rows[0].name.toUpperCase();
  assert.throws(() => createGameFromRows('Game','',rows), /highlighted/);
  rows[1].name='other'; rows[0].audioInput='javascript:alert(1)';
  assert.ok(rowErrors(rows[0],rows).audioInput);
  assert.throws(() => createGameFromRows('Game','',[]), /at least one/);
});
test('XLSX supports sheets, hyperlink values and cached formula links', async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Cover').addRow(['Project notes']);
  const sheet = book.addWorksheet('Sounds');
  sheet.addRow(['Sound name','Category','Audio link','Video link','Current Status']);
  sheet.addRow(['button_tap','UI',{text:'tap.wav',hyperlink:'https://example.com/tap.wav'},{formula:'HYPERLINK("https://example.com/preview.mp4","Preview")',result:'Preview'},'Approved']);
  const bytes = await book.xlsx.writeBuffer();
  const sheets = await readSpreadsheet(new File([bytes], 'sounds.xlsx'));
  assert.equal(sheets.length,2);
  const rows = rowsFromSheet(prepareSheet(sheets[1]));
  assert.equal(rows[0].audioInput,'https://example.com/tap.wav');
  assert.equal(rows[0].audioName,'tap.wav');
  assert.equal(rows[0].videoInput,'https://example.com/preview.mp4');
  const created = createGameFromRows('Game','42',rows);
  assert.equal(created.assets[0].name,'tap.wav');
  assert.equal(created.game.cues[0].videoUrl,'https://example.com/preview.mp4');
});
test('new game saves media, filename-only references and genuine creation audit', () => {
  const rows = SOUND_SUGGESTIONS.map(([name,category,description,trigger]) => ({...blankDraftRow(),name,category,description,trigger,status:'Ready for implementation'}));
  rows[0].audioInput='https://example.com/tap.wav'; rows[0].audioName='tap.wav';
  rows[1].audioInput='window.wav'; rows[1].videoInput='window.mov';
  rows[2].audioInput=rows[0].audioInput;
  const {game,assets} = createGameFromRows(' QA Game ','123',rows);
  assert.equal(assets.length,1);
  assert.equal(game.cues[1].assetId,null);
  assert.equal(game.cues[1].audioReference,'window.wav');
  assert.equal(game.cues[1].videoReference,'window.mov');
  assert.equal(game.cues[0].assetId,game.cues[2].assetId);
  const next = validateState({...seed,games:[...seed.games,game],assets:[...seed.assets,...assets]});
  const saved = stampAudit(next,seed,'QA editor','2026-11-11T10:00:00.000Z');
  assert.equal(saved.games.at(-1).createdBy,'QA editor');
  assert.equal(saved.games.at(-1).cues[0].createdAt,'2026-11-11T10:00:00.000Z');
  assert.equal(saved.games.at(-1).cues[0].statusHistory,undefined);
});
test('unsupported, empty and oversized spreadsheets report errors', async () => {
  await assert.rejects(readSpreadsheet(new File(['x'],'test.xls')), /XLSX or CSV/);
  assert.throws(() => prepareSheet({name:'Empty',rows:[]}), /empty/);
  assert.throws(() => prepareSheet({name:'Large',rows:[['Sound ID'],...Array.from({length:501},(_,i)=>['cue'+i])]}), /500 sound/);
});

test('default suggestions are never stored as content and unused rows are skipped', () => {
  const rows = templateRows();
  assert.equal(rows.length,5);
  for (const row of rows) for (const field of ['name','description','trigger','category','status']) assert.equal(row[field], '');
  assert.throws(() => createGameFromRows('Game','',rows), /at least one/);
  Object.assign(rows[0], {name:'my_sound',category:'UI',status:'Ready for implementation'});
  const result = createGameFromRows('Game','',rows);
  assert.equal(result.game.cues.length,1);
  assert.equal(result.game.cues[0].trigger,'');
  assert.equal(result.game.cues[0].description,'');
  assert.equal(result.game.cues[0].suggestion,undefined);
  rows[1].description='Started but incomplete';
  assert.throws(() => createGameFromRows('Game','',rows), /Sound ID/);
});
test('missing category and status can save with no category and Open status', () => {
  const [row] = rowsFromSheet(prepareSheet({name:'UI',rows:[['Sound ID'],['button_tap']]}));
  assert.equal(row.category,''); assert.equal(row.status,''); assert.equal(row.trigger,'');
  assert.deepEqual(rowErrors(row,[row]),{});
  const {game,assets}=createGameFromRows('Incomplete spec','',[row]);
  const state=validateState({...seed,games:[...seed.games,game],assets:[...seed.assets,...assets]});
  assert.equal(state.games.at(-1).cues[0].category,'');assert.equal(state.games.at(-1).cues[0].status,'Open');
});
test('Cerberator links stay references and can coexist with attached audio', () => {
  const link='https://woylie-quoll-galah.vercel.app/sounds?id=123';
  const row={...blankDraftRow(),name:'tap',category:'UI',status:'Ready for implementation',audioInput:link};
  let result=createGameFromRows('Game','',[row]);
  assert.equal(result.assets.length,0); assert.equal(result.game.cues[0].libraryReferenceUrl,link);
  const attached={...row,audioInput:'data:audio/wav;base64,UklGRg==',audioName:'tap.wav'};
  const changed={...attached,...audioLinkChange(attached,link)};
  result=createGameFromRows('Game','',[changed]);
  assert.equal(result.assets.length,1); assert.equal(result.assets[0].audioUrl,attached.audioInput);
  assert.equal(result.game.cues[0].libraryReferenceUrl,link);
  const [imported]=rowsFromSheet(prepareSheet({name:'Sounds',rows:[['Sound ID','Audio link','Category','Status'],['tap',link,'UI','Approved']]}));
  assert.equal(imported.audioInput,''); assert.equal(imported.libraryReferenceUrl,link);
});

test('media imports prioritize links and recognize video-file headers and embedded URLs', () => {
  const prepared=prepareSheet({name:'Sounds',rows:[['Sound ID','Audio file','Audio URL','Video file (optional)'],['tap','tap.wav','https://example.com/tap.wav','Watch: https://example.com/tap.mp4']]});
  const [row]=rowsFromSheet(prepared);
  assert.equal(row.audioInput,'https://example.com/tap.wav');
  assert.equal(row.videoInput,'https://example.com/tap.mp4');
  assert.equal(row.importExtras['Audio file'],'tap.wav');
  const [inferred]=rowsFromSheet(prepareSheet({name:'Sounds',rows:[['Sound ID','Delivery','Clip'],['tap',{text:'tap.wav',hyperlink:'https://drive.google.com/file/d/audio/view'},{text:'preview.mov',hyperlink:'https://drive.google.com/file/d/video/view'}]]}));
  assert.equal(inferred.audioInput,'https://drive.google.com/file/d/audio/view');
  assert.equal(inferred.videoInput,'https://drive.google.com/file/d/video/view');
});
test('game icon validation and audit preserve the saved image', () => {
  validateGameIconFile({name:'icon.png',size:100});
  assert.throws(()=>validateGameIconFile({name:'icon.svg',size:100}),/PNG/);
  assert.throws(()=>validateGameIconFile({name:'icon.png',size:3*1024*1024}),/2 MB/);
  const next=structuredClone(seed); next.games[0].iconUrl='data:image/png;base64,aGVsbG8=';
  validateState(next);
  const saved=stampAudit(next,seed,'QA editor','2026-11-11T10:00:00.000Z');
  assert.equal(saved.games[0].iconUrl,next.games[0].iconUrl);
  assert.equal(saved.games[0].updatedBy,'QA editor');
  next.games[0].iconUrl='javascript:alert(1)';
  assert.throws(()=>validateState(next),/game icon/);
});

test('TMI Reference File hyperlinks ask for a destination then fill audio', async () => {
  const book = new ExcelJS.Workbook();
  const source = book.addWorksheet('Reference');
  source.addRow(['Reference Clip','Sound ID','Phase','Category','Description','Trigger / When To Play','Reference File','Reference Link','Phase Rationale']);
  const links = ['https://drive.google.com/file/d/coin-appear/view','https://drive.google.com/file/d/coin-collect/view'];
  for (const [i,name] of ['coin_appear','coin_collect','ui_click'].entries()) {
    source.addRow([name,name,'MVP','Reward','Reward sound','Collect reward',links[i] ? {text:links[i],hyperlink:links[i]} : null,null,'MVP']);
  }
  const bytes = await book.xlsx.writeBuffer();
  const [sheet] = await readSpreadsheet(new File([bytes],'TMI.xlsx'));
  const prepared = prepareSheet(sheet);
  const pending = rowsFromSheet(prepared);
  assert.equal(prepared.mapping.audio,-1);
  assert.equal(pending[0].audioInput,'');
  assert.equal(pending[0].pendingLinks.length,1);
  assert.ok(rowErrors(pending[0],pending).importLinks);
  const rows = rowsFromSheet(prepared,prepared.mapping,{6:'audio'});
  assert.deepEqual(rows.map(row=>row.audioInput),[...links,'']);
  assert.ok(rows.every(row=>row.videoInput === '' && row.referenceUrl === ''));
  const created = createGameFromRows('TMI','',rows.map(row=>({...row,status:'Ready for implementation'})));
  assert.deepEqual(created.assets.map(asset=>asset.audioUrl),links);
  assert.equal(created.game.cues[2].assetId,null);
});


test('generic columns classify known media per row and ask only for opaque links', () => {
  const p=prepareSheet({name:'Sounds',rows:[['Sound ID','Delivery'],['one','https://example.com/one.wav'],['two','https://example.com/two.mp4'],['three','https://drive.google.com/file/d/three/view']]});
  let rows=rowsFromSheet(p);
  assert.equal(rows[0].audioInput,'https://example.com/one.wav');
  assert.equal(rows[1].videoInput,'https://example.com/two.mp4');
  assert.equal(rows[2].pendingLinks.length,1);
  rows=rowsFromSheet(p,p.mapping,{1:'audio'});
  assert.equal(rows[1].videoInput,'https://example.com/two.mp4');
  assert.equal(rows[2].audioInput,'https://drive.google.com/file/d/three/view');
  rows=rowsFromSheet(p,p.mapping,{1:'mixed','1:2':'reference'});
  assert.equal(rows[2].referenceUrl,'https://drive.google.com/file/d/three/view');
  assert.equal(rows[2].audioInput,'');
  assert.equal(rows[2].pendingLinks.length,0);
});

test('explicit media is not overwritten and generic Cerberator links stay references', () => {
  const url='https://woylie-quoll-galah.vercel.app/sounds?id=test';
  const p=prepareSheet({name:'Sounds',rows:[['Sound ID','Audio file','Delivery','Library selection'],['one','https://example.com/one.wav','https://drive.google.com/file/d/extra/view',url]]});
  let [row]=rowsFromSheet(p,p.mapping,{2:'audio'});
  assert.equal(row.audioInput,'https://example.com/one.wav');
  assert.equal(row.pendingLinks.length,0);
  assert.equal(row.extraAudio[0].url,'https://drive.google.com/file/d/extra/view');
  assert.equal(row.libraryReferenceUrl,url);
  [row]=rowsFromSheet(p,p.mapping,{2:'reference'});
  assert.equal(row.pendingLinks.length,0);
  assert.equal(row.referenceUrl,'https://drive.google.com/file/d/extra/view');
});


const copiedLibrarySound = {
  id:'snd_example_music', title:'Example calm music',
  game:'Example Game', category:'music', duration_sec:61.7143,
  tags:[{id:'mood.calm',source:'clap',score:0.2785},{id:'texture.deep',source:'clap',score:0.3398}],
  metadata_url:'https://woylie-quoll-galah.vercel.app/sounds-library/api/sounds/snd_example_music',
  audio_url:'https://woylie-quoll-galah.vercel.app/sounds-library/media/snd_example_music/original',
  preview_url:'https://woylie-quoll-galah.vercel.app/sounds-library/media/snd_example_music/preview',
};
test('Copy for AI parses reference metadata and survives save and backup without becoming creator audio', () => {
  const reference=parseLibraryReference(JSON.stringify(copiedLibrarySound));
  assert.equal(reference.title,copiedLibrarySound.title);
  assert.equal(reference.duration_sec,61.7143);
  assert.equal(reference.tags[0].id,'mood.calm');
  const row={...blankDraftRow(),name:'music',category:'Music',status:'Ready for implementation',libraryReference:reference,libraryReferenceId:reference.id,libraryReferenceUrl:reference.metadata_url};
  let result=createGameFromRows('Game','',[row]);
  assert.equal(result.assets.length,0);
  assert.equal(result.game.cues[0].assetId,null);
  row.audioInput='https://example.com/creator.wav';
  result=createGameFromRows('Game','',[row]);
  assert.equal(result.assets[0].audioUrl,row.audioInput);
  const next=validateState(JSON.parse(JSON.stringify({...seed,games:[...seed.games,result.game],assets:[...seed.assets,...result.assets]})));
  assert.deepEqual(next.games.at(-1).cues[0].libraryReference,reference);
  assert.deepEqual(parseLibraryReference('```json\n'+JSON.stringify(copiedLibrarySound)+'\n```'),reference);
  const change=audioLinkChange(row,'https://example.com/replacement.wav');
  assert.equal({...row,...change}.libraryReference.id,reference.id);
});
test('Copy for AI rejects malformed or unsafe references and permits metadata without a preview', () => {
  for(const text of ['{}','[]','{bad json','{"id":"snd_x"}']) assert.throws(()=>parseLibraryReference(text));
  for(const preview_url of ['javascript:alert(1)','https://example.com/audio.mp3','https://woylie-quoll-galah.vercel.app.evil.example/audio']) assert.throws(()=>parseLibraryReference(JSON.stringify({...copiedLibrarySound,preview_url})),/Cerberator/);
  assert.throws(()=>parseLibraryReference(JSON.stringify({...copiedLibrarySound,duration_sec:-1})),/duration/);
  assert.equal(parseLibraryReference('{"id":"snd_test","title":"Test"}').preview_url,'');
  const next=structuredClone(seed);
  next.games[0].cues[0].libraryReference={...copiedLibrarySound,preview_url:'javascript:alert(1)'};
  assert.throws(()=>validateState(next),/Cerberator/);
});


test('demo library merges saved references, deduplicates IDs and filters title, game and tags', () => {
  const second={...copiedLibrarySound,id:'snd_ui_click',title:'Soft UI click',game:'Demo UI',category:'ui',tags:[{id:'texture.soft'}]};
  const catalog=libraryCatalog([copiedLibrarySound,second,{id:'invalid'}]);
  assert.equal(catalog.length,2);
  assert.equal(filterLibraryCatalog(catalog,'soft','ui','Demo UI')[0].id,'snd_ui_click');
  assert.equal(filterLibraryCatalog(catalog,'calm')[0].id,copiedLibrarySound.id);
  assert.equal(filterLibraryCatalog(catalog,'no matching sound').length,0);
  assert.equal(filterLibraryCatalog(catalog,'','music','Demo UI').length,0);
});


test('choosing an uploaded file reuses its identity without duplicating the file or losing its reference', () => {
  const asset = {id:'existing-audio',name:'reward.wav',audioUrl:'/uploads/reward.wav'};
  const reference = libraryCatalog([copiedLibrarySound])[0];
  const row = {...blankDraftRow(),name:'reward',category:'Reward',status:'Ready for implementation',existingAssetId:asset.id,audioName:asset.name,libraryReference:reference,libraryReferenceId:reference.id,libraryReferenceUrl:reference.metadata_url};
  const result = createGameFromRows('New game','',[row],[asset]);
  assert.equal(result.game.cues[0].assetId,asset.id);
  assert.equal(result.assets.length,0);
  assert.equal(result.game.cues[0].libraryReference.id,reference.id);
  assert.equal('existingAssetId' in result.game.cues[0],false);
  assert.throws(()=>createGameFromRows('New game','',[row],[]),/no longer available/);
  assert.equal(audioLinkChange({...row,existingAssetId:null},'https://example.com/new.wav').existingAssetId,null);
  assert.equal(audioLinkChange(row,'https://example.com/reference').libraryReferenceUrl,'https://example.com/reference');
});


test('exported catalog validates all 3142 sounds, supports search and preserves reference identity', () => {
  const raw = {schemaVersion:1,sounds:Array.from({length:3142},(_,i)=>({id:'snd_fixture_'+i,title:'Calm music '+i,game:'Fixture Game '+(i%59),category:'category_'+(i%9),tags:[{id:'mood.calm'}],duration_sec:1,metadata_url:'https://woylie-quoll-galah.vercel.app/sounds-library/api/sounds/snd_fixture_'+i,audio_url:'https://woylie-quoll-galah.vercel.app/sounds-library/media/snd_fixture_'+i+'/original',preview_url:'https://woylie-quoll-galah.vercel.app/sounds-library/media/snd_fixture_'+i+'/preview'}))};
  const snapshot = validateCatalogSnapshot(raw);
  assert.equal(snapshot.sounds.length,3142);
  assert.equal(new Set(snapshot.sounds.map(s=>s.game)).size,59);
  assert.equal(new Set(snapshot.sounds.map(s=>s.category)).size,9);
  for (const sound of snapshot.sounds) {
    assert.ok(sound.audio_url.startsWith('https://woylie-quoll-galah.vercel.app/sounds-library/media/'));
    assert.ok(sound.preview_url.endsWith('/preview'));
    assert.ok(Number.isFinite(sound.duration_sec));
    assert.equal('blob' in sound,false);
    assert.equal('blob_url' in sound,false);
  }
  const catalog = libraryCatalog([],snapshot.sounds);
  assert.equal(catalog.length,3142);
  const selected = filterLibraryCatalog(catalog,'calm music')[0];
  assert.ok(selected);
  assert.equal(filterLibraryCatalog(catalog,selected.id)[0].id,selected.id);
  assert.ok(filterLibraryCatalog(catalog,'','', 'Fixture Game 1').every(s=>s.game==='Fixture Game 1'));
  assert.equal(libraryCatalog([selected],snapshot.sounds).length,3142);
  const row = {...blankDraftRow(),name:'test_reference',category:'Music',status:'Ready for implementation',libraryReference:selected,libraryReferenceId:selected.id,libraryReferenceUrl:selected.metadata_url};
  const created = createGameFromRows('Catalog QA','',[row]);
  assert.equal(created.game.cues[0].libraryReference.id,selected.id);
  assert.equal(created.game.cues[0].assetId,null);
  assert.equal(created.assets.length,0);
  assert.throws(()=>validateCatalogSnapshot({...raw,sounds:[selected,selected]}),/duplicate/);
  assert.throws(()=>validateCatalogSnapshot({...raw,sounds:[{...selected,preview_url:'https://untrusted.example/audio'}]}),/Cerberator/);
});

test('clearing a pasted library link removes it without detaching an uploaded file',()=>{
 const row={...blankDraftRow(),libraryReferenceUrl:'https://woylie-quoll-galah.vercel.app/sounds?id=123',existingAssetId:'keep-audio'};
 const changed={...row,...audioLinkChange(row,'')};
 assert.equal(changed.libraryReferenceUrl,'');
 assert.equal(changed.existingAssetId,'keep-audio');
});


test('unfinished drafts survive storage without creating fake cues or losing pending links and media', () => {
  const rows=templateRows();
  rows[0].description='Still deciding';
  rows[0].audioInput='data:audio/wav;base64,UklGRg==';
  rows[0].pendingLinks=[{key:'2:0',url:'https://drive.google.com/file/d/example/view'}];
  const draft=saveWorkingDraft(null,{name:'Draft game',iconUrl:'',rows,filename:'source.csv',mapping:{name:0},linkChoices:{},workbook:[]});
  const stored=validateState(JSON.parse(JSON.stringify({...seed,games:[...seed.games,draft]})));
  const reopened=stored.games.at(-1);
  assert.equal(reopened.cues.length,0);
  assert.equal(reopened.workingDraft.rows.length,5);
  assert.equal(reopened.workingDraft.rows[0].name,'');
  assert.equal(reopened.workingDraft.rows[0].audioInput,rows[0].audioInput);
  assert.equal(reopened.workingDraft.rows[0].pendingLinks[0].key,'2:0');
  assert.throws(()=>createGameFromRows('Draft game','',reopened.workingDraft.rows),/Sound ID/);
});
test('edit list round-trip preserves cue IDs, media, references and audit for untouched cues',()=>{
  const original=structuredClone(seed.games[0]);
  const rows=rowsForGame(original,seed.assets);
  const result=createGameFromRows(original.name,original.externalGameId || '',rows,seed.assets,original);
  assert.deepEqual(result.game.cues,original.cues);
  assert.equal(result.game.id,original.id);
  assert.equal(result.assets.length,0);
  const next=stampAudit({...seed,games:[result.game,...seed.games.slice(1)]},seed,'Reviewer','2026-11-23T00:00:00Z');
  assert.equal(next.games[0].cues[0].updatedAt,original.cues[0].updatedAt || null);
});
test('draft edits are separate from viewer; completing them keeps identity and records status changes',()=>{
  const original=structuredClone(seed.games[0]);
  const rows=rowsForGame(original,seed.assets);
  rows[0].description='Edited description';rows[0].status='Implemented';
  const draft=saveWorkingDraft(original,{name:original.name,iconUrl:'',rows});
  assert.deepEqual(draft.cues,original.cues);
  const result=createGameFromRows(draft.name,'',draft.workingDraft.rows,seed.assets,draft);
  assert.equal(result.game.workingDraft,undefined);
  assert.equal(result.game.cues[0].id,original.cues[0].id);
  assert.equal(result.game.cues[0].description,'Edited description');
  const saved=stampAudit({...seed,games:[result.game,...seed.games.slice(1)]},seed,'Reviewer','2026-11-23T00:00:00Z');
  assert.equal(saved.games[0].cues[0].statusHistory.at(-1).by,'Reviewer');
  assert.equal(saved.games[0].cues[0].updatedBy,'Reviewer');
});
test('a stale list draft cannot overwrite newer cue or status changes',()=>{
  const original=structuredClone(seed.games[0]);
  const draft=saveWorkingDraft(original,{name:original.name,iconUrl:'',rows:rowsForGame(original,seed.assets)});
  draft.cues[0].status='Blocked';
  const resaved=saveWorkingDraft(draft,draft.workingDraft);
  assert.throws(()=>createGameFromRows(resaved.name,'',resaved.workingDraft.rows,seed.assets,resaved),/changed after this draft/);
});


test('all sample games retain every cue and media reference through bulk edit',()=>{
  for (const game of seed.games) {
    const result=createGameFromRows(game.name,game.externalGameId || '',rowsForGame(game,seed.assets),seed.assets,game);
    assert.deepEqual(result.game.cues,game.cues);
    assert.equal(result.assets.length,0);
  }
});
test('audit metadata added during draft save does not create a false resume conflict',()=>{
  const game=seed.games[0];
  const draft=saveWorkingDraft(game,{name:game.name,iconUrl:'',rows:rowsForGame(game,seed.assets)});
  const persisted=stampAudit({...seed,games:[draft,...seed.games.slice(1)]},seed,'Draft author');
  assert.doesNotThrow(()=>createGameFromRows(draft.name,'',persisted.games[0].workingDraft.rows,seed.assets,persisted.games[0]));
});


test('incomplete draft reopens and saves without category, description or media; invalid data still fails',()=>{
  const row={...blankDraftRow(),name:'button_tap'};
  const draft=saveWorkingDraft(null,{name:'Draft QA',iconUrl:'',rows:[row],workbook:[]});
  const stored=validateState(JSON.parse(JSON.stringify({...seed,games:[...seed.games,draft]}))).games.at(-1);
  const {game}=createGameFromRows(stored.workingDraft.name,'',stored.workingDraft.rows,[],stored);
  assert.equal(game.workingDraft,undefined);assert.equal(game.cues[0].status,'Open');assert.equal(game.cues[0].category,'');
  assert.equal(cueDescription(game.cues[0]),'');assert.equal(game.cues[0].assetId,null);
  const reopened=rowsForGame(game);reopened[0].notes='Still waiting for sound design';
  assert.equal(createGameFromRows(game.name,'',reopened,[],game).game.cues[0].notes,reopened[0].notes);
  const withAudio=createGameFromRows('Audio without category','',[{...row,audioInput:'https://example.com/tap.wav'}]);
  validateState({...seed,games:[...seed.games,withAudio.game],assets:[...seed.assets,...withAudio.assets]});
  assert.throws(()=>createGameFromRows('','',[row]),/game title/);
  assert.throws(()=>createGameFromRows('Test','',[{...row,name:''}]),/at least one/);
  assert.throws(()=>createGameFromRows('Test','',[{...row,audioInput:'javascript:alert(1)'}]),/highlighted/);
});

test('sound-sheet selection finds Event-based SFX behind unrelated and oversized tabs',async()=>{
  const wb=new ExcelJS.Workbook();
  wb.addWorksheet('Milestones').addRows([['Name','Status'],['M1','Done']]);
  wb.addWorksheet('feature list').addRows([['Name','Description'],['Booster','Design work']]);
  wb.addWorksheet('Roadmap').addRow(['Notes']);
  const bots=wb.addWorksheet('bot_names');bots.getCell('A5001').value='Bot';
  wb.addWorksheet('SFX List').addRows([['No.','Audio Type','Event','Description','Video Preview','Final File','Status'],[1,'SFX – Core Gameplay','All Found','','clip.mov','https://example.com/all_found.wav','Implemented']]);
  wb.addWorksheet('Haptics').addRows([['Name','Status'],['Tap','Done']]);
  const sheets=await readSpreadsheet(new File([await wb.xlsx.writeBuffer()],'mixed.xlsx'));
  assert.equal(selectSoundSheet(sheets),4);assert.ok(sheets[3].error);
  const [row]=rowsFromSheet(prepareSheet(sheets[4]));assert.equal(row.name,'all_found');assert.equal(row.audioInput,'https://example.com/all_found.wav');
  assert.equal(selectSoundSheet([{name:'Empty',rows:[]},sheets[4]]),1);
  assert.equal(selectSoundSheet([sheets[0],sheets[1],sheets[5]]),-1);
  assert.equal(selectSoundSheet([{...sheets[4],name:'SFX List before setup'},sheets[4]]),1);
});

test('combined field preserves legacy text, manual edits, drafts and exported import headers',()=>{
  const old={...blankDraftRow(),name:'tap',description:'Soft click',trigger:'When the button is tapped'};
  assert.equal(cueDescription(old),'Soft click\nWhen the button is tapped');
  assert.equal(cueDescription({...old,trigger:'Soft click'}),'Soft click');
  const edited={...old,description:cueDescription(old)+'\nAvoid repetition.',trigger:''};
  const draft=saveWorkingDraft(null,{name:'Combined',rows:[edited],iconUrl:''});
  const {game}=createGameFromRows('Combined','',draft.workingDraft.rows);
  assert.equal(cueDescription(rowsForGame(game)[0]),edited.description);
  const csv='Sound ID,Description/Trigger When\ntap,"'+edited.description+'"';
  const [imported]=rowsFromSheet(prepareSheet({name:'CSV',rows:parseCsv(csv)}));
  assert.equal(cueDescription(imported),edited.description);
  assert.equal(cueDescription({...edited,description:'',trigger:''}),'');
});

test('draft and final specs share visible cues and preserve cue status and audit history',()=>{
  const row={...blankDraftRow(),name:'button_tap',status:'Implemented'};
  const {game}=createGameFromRows('Spec readiness','',[row]);
  const draft=stampAudit({...seed,games:[...seed.games,{...game,specStatus:'draft'}]},seed,'Editor','2026-11-24T01:00:00Z');
  const restored=validateState(JSON.parse(JSON.stringify(draft)));
  const saved=restored.games.at(-1);
  assert.equal(saved.specStatus,'draft');
  assert.equal(saved.cues[0].name,'button_tap');
  assert.equal(saved.workingDraft,undefined);
  const edited=createGameFromRows(saved.name,'',rowsForGame(saved,restored.assets),restored.assets,saved).game;
  edited.specStatus='final';
  const final=stampAudit({...restored,games:restored.games.map(g=>g.id===edited.id?edited:g)},restored,'Reviewer','2026-11-24T02:00:00Z');
  const result=validateState(JSON.parse(JSON.stringify(final))).games.at(-1);
  assert.equal(result.specStatus,'final');
  assert.deepEqual(result.cues,saved.cues);
  assert.equal(result.updatedBy,'Reviewer');
  const invalid=structuredClone(final);invalid.games.at(-1).specStatus='implemented';
  assert.throws(()=>validateState(invalid),/Invalid spec status/);
});

test('draft requires only a game title and keeps unnamed rows until finalized',()=>{
  assert.throws(()=>createGameFromRows('','',[],[],null,'draft'),/game title/);
  const empty=createGameFromRows('Title only','',templateRows(),[],null,'draft').game;
  assert.equal(empty.cues.length,0);
  validateState({...seed,games:[...seed.games,empty]});
  const rows=[{...blankDraftRow(),description:'Soft click'},{...blankDraftRow(),notes:'Need a second variation'}];
  const {game}=createGameFromRows('Unfinished','',rows,[],null,'draft');
  const restored=validateState(JSON.parse(JSON.stringify({...seed,games:[...seed.games,game]}))).games.at(-1);
  assert.equal(restored.cues.length,2);
  assert.deepEqual(restored.cues.map(c=>c.name),['','']);
  const reopened=rowsForGame(restored);
  assert.equal(reopened[0].description,'Soft click');
  assert.equal(reopened[1].notes,'Need a second variation');
  assert.throws(()=>createGameFromRows(restored.name,'',reopened,[],restored,'final'),/Sound ID/);
  assert.throws(()=>validateState({...seed,games:[{...restored,specStatus:'final'}]}),/unique name/);
  reopened.forEach((row,i)=>row.name=`button_${i}`);
  const final=createGameFromRows(restored.name,'',reopened,[],restored,'final').game;
  validateState({...seed,games:[...seed.games,final]});
  assert.equal(final.cues[0].id,restored.cues[0].id);
  assert.equal(final.specStatus,'final');
});
