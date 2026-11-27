import React, { useEffect, useRef, useState } from "react";
import Editor from "./components/Editor";
import Viewer from "./components/Viewer";
import Library from "./components/Library";
import NewGame from "./components/NewGame";
import {cueAudioIds,cueVideos,rowFiles,setCueAudio} from "./cue-media";
import {hasDraftContent} from "./new-game";
import {
  Button,
  Field,
  Icon,
  Modal,
  AuditDetails,
  GamePicker,
  GameIconUpload,
} from "./components/ui";
import {
  emptyCue,
  cueDescription,
  fileUsages,
  removeUploadedFile,
  validateState,
  safeUrl,
  CATEGORIES,
  migrateState,
  validateMediaFile,
} from "./model";
import { repository, LIBRARY_URL, SHARED_DEMO, PUBLIC_DEMO } from "./adapters/repository";
function route() {
  const q = new URLSearchParams(location.hash.slice(1));
  return { page: q.get("page") || "viewer", game: q.get("game") || "tmi" };
}
function download(name, content, type) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
// This browser-only workspace is mounted client-side by SoundStudioClient.
export default function Workspace({ renderShell, user = null }) {
  const [saved, setSaved] = useState(null),
    [draft, setDraft] = useState(null),
    [r, setR] = useState(route),
    [selected, setSelected] = useState("coin_appear"),
    [modal, setModal] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pendingSpecSave,setPendingSpecSave] = useState(null);
  const [pendingFileDelete,setPendingFileDelete] = useState(null);
  const [fileUndo,setFileUndo] = useState(null);
  const [newGameDirty, setNewGameDirty] = useState(false);
  const [mediaBusy,setMediaBusy]=useState(false);
  const approvedNavigation = useRef(false);
  const [demoRole, setDemoRole] = useState("Editor");
  const canEdit = PUBLIC_DEMO ? ["Admin", "Editor"].includes(demoRole) : ["admin", "editor"].includes(user?.role);
  const canStatus = canEdit || (PUBLIC_DEMO && demoRole === "Developer");
  const [editorName, setEditorName] = useState(
    () => user?.email || localStorage.getItem(PUBLIC_DEMO ? "cerebral-sound-studio-demo-name" : "sound-studio-editor-name") || (PUBLIC_DEMO ? "Demo visitor" : "Andreas Rinanto"),
  );
  const dirty =
    saved && draft && JSON.stringify(saved) !== JSON.stringify(draft);
  useEffect(() => {
    repository
      .load()
      .then((s) => {
        setSaved(s);
        setDraft(structuredClone(s));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const cb = () => {
      const next = route();
      if (approvedNavigation.current) { approvedNavigation.current = false; setR(next); return; }
      if (newGameDirty && (next.page !== r.page || next.game !== r.game)) {
        if (!confirm("Discard these unsaved list edits?")) { history.replaceState(null, '', '#' + new URLSearchParams(r)); return; }
        setNewGameDirty(false);
      }
      setR(next);
    };
    window.addEventListener("hashchange", cb);
    return () => window.removeEventListener("hashchange", cb);
  }, [newGameDirty, r.page, r.game]);
  useEffect(() => {
    const cb = (e) => {
      if (dirty || newGameDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", cb);
    return () => window.removeEventListener("beforeunload", cb);
  }, [dirty, newGameDirty]);
  useEffect(() => {
    if (!message) return;
    if (fileUndo) return;
    const t = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(t);
  }, [message,fileUndo]);
  function go(page, game = r.game) {
    if (page === r.page && game === r.game) return;
    if (
      (dirty || newGameDirty) &&
      !confirm("Discard unsaved changes and open the saved list?")
    )
      return;
    if (dirty) setDraft(structuredClone(saved));
    setNewGameDirty(false);
    approvedNavigation.current = true;
    location.hash = new URLSearchParams({ page, game });
    setR({ page, game });
    setSelected(
      game === r.game && ["viewer", "editor"].includes(page) ? selected :
      (page === "editor" ? draft : saved)?.games.find((g) => g.id === game)
        ?.cues[0]?.id || "",
    );
  }
  const data = r.page === "viewer" || r.page === "saved" ? saved : draft;
  const game = data?.games.find((g) => g.id === r.game) || data?.games[0];
  useEffect(() => {
    if (game && !game.cues.some((c) => c.id === selected))
      setSelected(game.cues[0]?.id || "");
  }, [game, selected]);
  useEffect(() => {
    if (!SHARED_DEMO || !saved || dirty || newGameDirty || busy) return;
    let active = true;
    const refresh = async () => {
      if(document.visibilityState !== 'visible') return;
      try {
        const latest = await repository.load();
        if(active && latest.revision !== saved.revision) {
          setSaved(latest); setDraft(structuredClone(latest));
          setMessage('Shared changes loaded.');
        }
      } catch { /* Keep the current view when offline; save errors remain visible. */ }
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus',refresh);
    return () => {active=false; clearInterval(timer); window.removeEventListener('focus',refresh);};
  }, [saved, dirty, newGameDirty, busy]);
  function updateGame(transform) {
    setDraft((s) => ({
      ...s,
      games: s.games.map((g) => (g.id === game.id ? transform(g) : g)),
    }));
  }
  async function save(next = draft) {
    setBusy(true);
    setError("");
    try {
      validateState(next);
      const v = await repository.save(next, editorName);
      setFileUndo(null);
      setSaved(v);
      setDraft(structuredClone(v));
      setMessage(PUBLIC_DEMO ? "Saved in this browser only. Other visitors still see the original samples." : "Sound list saved. Viewer now shows this version.");
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function confirmSpecSave(specStatus) {
    if (!pendingSpecSave || busy || !canEdit) return;
    setError("");
    let prepared;
    try {prepared = pendingSpecSave.prepare ? pendingSpecSave.prepare(specStatus) : pendingSpecSave;}
    catch(e) {setError(e.message);return;}
    const {next,gameId} = prepared;
    const nextState = {...next,games:next.games.map(g=>g.id===gameId ? {...g,specStatus} : g)};
    if (await save(nextState)) {
      setPendingSpecSave(null);setNewGameDirty(false);approvedNavigation.current=true;
      const route = {page:"viewer",game:gameId};
      setR(route);location.hash=new URLSearchParams(route);
      const savedGame=nextState.games.find(g=>g.id===gameId);
      if(!savedGame.cues.some(c=>c.id===selected))setSelected(savedGame.cues[0]?.id || "");
      setMessage(`${specStatus === 'draft' ? 'Draft' : 'Final spec'} saved. ${PUBLIC_DEMO ? 'Your changes stay in this browser.' : 'Your latest changes are visible in Sound Specs.'}`);
    }
  }
  async function renameSpec(g) {
    const name = prompt("Game title", g.name)?.trim();
    if (!name || name === g.name) return;
    await save({
      ...saved,
      games: saved.games.map((x) => (x.id === g.id ? { ...x, name, ...(x.workingDraft ? {workingDraft:{...x.workingDraft,name}} : {}) } : x)),
    });
  }
  async function duplicateSpec(g) {
    const name = prompt(
      "Name for the copied sound list",
      g.name + " copy",
    )?.trim();
    if (!name) return;
    const copy = {
      ...structuredClone(g),
      id: crypto.randomUUID(),
      name,
      cues: g.cues.map((c) => ({ ...c, id: crypto.randomUUID() })),
    };
    if (copy.workingDraft) {
      const cueIds = new Map(g.cues.map((cue,index)=>[cue.id,copy.cues[index].id]));
      copy.workingDraft.name=name;
      copy.workingDraft.rows=copy.workingDraft.rows.map(row=>({...row,id:cueIds.get(row.id) || crypto.randomUUID()}));
      copy.workingDraft.baseCues=structuredClone(copy.cues);
    }
    delete copy.importedAt;
    delete copy.importedBy;
    await save({ ...saved, games: [...saved.games, copy] });
  }
  async function deleteSpec(g) {
    if (saved.games.length === 1) {
      setMessage("Keep at least one game sound list.");
      return;
    }
    if (
      !confirm(
        `Delete the saved spec for ${g.name}? Export a backup first if you need a copy. Audio assets will be kept; this spec’s video references will be removed.`,
      )
    )
      return;
    await save({ ...saved, games: saved.games.filter((x) => x.id !== g.id) });
  }
  function addCue() {
    if (!canEdit) return;
    location.hash = new URLSearchParams({page: "editor", game: game.id});
    setR({page: "editor", game: game.id});
    const c = emptyCue();
    let n = 1;
    while (game.cues.some((x) => x.name === c.name))
      c.name = "new_sound_" + n++;
    updateGame((g) => ({ ...g, cues: [...g.cues, c] }));
    setSelected(c.id);
  }
  function duplicate(id) {
    if (!canEdit || r.page === "editor") return;
    const original = game.cues.find((c) => c.id === id);
    if (!original) return;
    let name = original.name + "_copy", n = 2;
    while (game.cues.some((c) => c.name === name)) name = original.name + "_copy_" + n++;
    const copy = { ...structuredClone(original), id: crypto.randomUUID(), name };
    setDraft({...structuredClone(saved), games: saved.games.map(g => g.id === game.id ? {...g, cues:[...g.cues, copy]} : g)});
    setSelected(copy.id);
    setR({page:"editor", game:game.id});
    location.hash = new URLSearchParams({page:"editor", game:game.id});
  }
  async function remove(id) {
    if (!canEdit || r.page === "editor") return;
    const cue = game.cues.find(c => c.id === id);
    if (!cue || !confirm(`Delete ${cue.name} from this sound spec? Uploaded files will be kept.`)) return;
    const cues = game.cues.filter(c => c.id !== id);
    if (await save({...saved, games:saved.games.map(g => g.id === game.id ? {...g, cues} : g)})) {
      if (selected === id) setSelected(cues[0]?.id || "");
    }
  }
  async function share(targetGame = game) {
    const url = new URL(location.href);
    url.hash = new URLSearchParams({ page: "viewer", game: targetGame.id });
    try {
      await navigator.clipboard.writeText(url.href);
      setMessage(
        PUBLIC_DEMO ? "Demo link copied. Your browser edits are not included; use Export backup to send your version." : SHARED_DEMO ? "Shared viewer link copied. The recipient needs demo access." : "Viewer link copied. This local prototype link opens on this computer.",
      );
    } catch {
      setMessage(url.href);
    }
  }
  function csv(targetGame = game) {
    const quote = (v) =>
      '"' +
      String(/^[=+@-]/.test(String(v)) ? "\t" + v : (v ?? "")).replaceAll(
        '"',
        '""',
      ) +
      '"';
    const rows = [
      [
        "Sound ID",
        "Category",
        "Description/Trigger When",
        "Status",
        "Notes",
        "Cerberator reference ID",
        "Cerberator reference link",
        "Creator audio URL",
        "Creator video URL",
        "Reference",
      ],
      ...targetGame.cues.map((c) => {
        return [
          c.name,
          c.category,
          cueDescription(c),
          c.status,
          c.notes || "",
          c.libraryReferenceId || "",
          c.libraryReferenceUrl || "",
          [...cueAudioIds(c).map(id=>saved.assets.find(a=>a.id===id)?.audioUrl),...(c.mediaSources || []).filter(s=>s.type==="audio").map(s=>s.url)].filter(Boolean).join("\n") || c.audioReference || "",
          [...cueVideos(c).map(v=>v.url),...(c.mediaSources || []).filter(s=>s.type==="video").map(s=>s.url)].join("\n") || c.videoReference || "",
          c.referenceUrl,
        ];
      }),
    ];
    download(
      targetGame.id + "-sounds.csv",
      "\uFEFF" + rows.map((row) => row.map(quote).join(",")).join("\r\n"),
      "text/csv",
    );
  }
  async function backup() {
    setBusy(true);
    try {
      const backup = structuredClone(saved),
        files = {};
      const urls = [
        ...backup.assets.map((a) => a.audioUrl),
        ...(backup.videos || []).map((v) => v.videoUrl),
        ...backup.games.flatMap(g=>g.cues.flatMap(c=>cueVideos(c).map(v=>v.url))),
        ...backup.games.flatMap(g => (g.workingDraft?.rows || []).flatMap(row=>[row.audioInput,row.videoInput])),
        ...backup.games.flatMap(g => (g.workingDraft?.baseCues || []).flatMap(c=>cueVideos(c).map(v=>v.url))),
        ...backup.games.flatMap(g=>(g.workingDraft?.rows || []).flatMap(r=>[...(r.extraAudio || []),...(r.extraVideo || [])].map(f=>f.url))),
      ].filter((u) => u?.startsWith("/uploads/"));
      for (const u of new Set(urls)) {
        const b = await (await fetch(u)).blob();
        files[u] = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.readAsDataURL(b);
        });
      }
      download(
        "sound-studio-backup.json",
        JSON.stringify({ data: backup, files }, null, 2),
        "application/json",
      );
      setMessage("Backup downloaded with uploaded media.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function restore(file) {
    if (!file) return;
    try {
      const pack = JSON.parse(await file.text());
      pack.data = migrateState(pack.data);
      validateState(pack.data);
      if (
        !confirm(
          PUBLIC_DEMO ? "Replace the saved lists in this browser with the backup? Other visitors are not affected." : "Replace this prototype’s saved lists with the backup? Download a backup first if needed.",
        )
      )
        return;
      setBusy(true);
      const mapping = {};
      for (const [old, b64] of Object.entries(pack.files || {})) {
        if (!old.startsWith("/uploads/") || !/^data:(audio|video)\//.test(b64))
          throw Error("Invalid media backup.");
        const b = await (await fetch(b64)).blob();
        const result = await repository.upload(
          new File([b], old.split("/").pop(), { type: b.type }),
        );
        mapping[old] = result.url;
      }
      const next = pack.data;
      next.revision = saved.revision;
      next.assets.forEach((a) => {
        a.audioUrl = mapping[a.audioUrl] || a.audioUrl;
      });
      next.videos?.forEach((v) => {
        v.videoUrl = mapping[v.videoUrl] || v.videoUrl;
      });
      next.games.forEach((g) =>
        g.cues.forEach((c) => {
          c.videoUrl = mapping[c.videoUrl] || c.videoUrl;
          for(const file of c.extraVideos || [])file.url=mapping[file.url] || file.url;
        }),
      );
      for (const g of next.games) if (g.workingDraft) {
        for (const row of g.workingDraft.rows) {
          row.audioInput=mapping[row.audioInput] || row.audioInput;
          row.videoInput=mapping[row.videoInput] || row.videoInput;
          if (row.videoUrl) row.videoUrl=mapping[row.videoUrl] || row.videoUrl;
          for(const file of [...(row.extraAudio || []),...(row.extraVideo || [])])file.url=mapping[file.url] || file.url;
        }
        for (const cue of g.workingDraft.baseCues) {cue.videoUrl=mapping[cue.videoUrl] || cue.videoUrl;for(const file of cue.extraVideos || [])file.url=mapping[file.url] || file.url;}
      }
      await save(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!saved)
    return renderShell(<div className="sound-studio">
      <div className="loading">
        <Icon name="wave" size={40} />
        <h1>Sound Studio</h1>
        <p>{error || "Loading your sound lists…"}</p>
        {error && <Button onClick={() => location.reload()}>Retry</Button>}
      </div></div>, {page:r.page, go, canEdit});
  if (!game && !["new","library","saved"].includes(r.page)) return renderShell(<div className="sound-studio"><h1>Sound Studio</h1><p>No sound specs yet.</p>{canEdit && <Button onClick={()=>go("new")}>New Game</Button>}</div>,{page:r.page,go,canEdit});
  return renderShell(
    <div className="sound-studio"><div className="app">
      {PUBLIC_DEMO && <details className="studio-demo-settings">
        <summary>Local preview · Changes stay in this browser</summary>
        <div className="studio-demo-settings-content">
          <div className="demo-controls">
            <label>Preview role<select aria-label="Preview role" value={demoRole} onChange={e => {
              if ((dirty || newGameDirty) && !confirm("Discard unsaved edits and change preview role?")) return;
              setDraft(structuredClone(saved)); setNewGameDirty(false); setDemoRole(e.target.value);
              if (["editor", "new", "list"].includes(r.page)) {approvedNavigation.current=true;setR({...r,page:"viewer"});location.hash=new URLSearchParams({page:"viewer",game:r.game});}
            }}>{["Admin","Editor","Developer","Viewer"].map(role=><option key={role}>{role}</option>)}</select></label>
            <label>Demo name<input aria-label="Editing as" value={editorName} maxLength={60} onChange={e=>{setEditorName(e.target.value);localStorage.setItem("cerebral-sound-studio-demo-name",e.target.value);}}/></label>
            <small>Role and name are simulated, not verified.</small>
          </div>
          <div className="studio-backup-actions">
            <Button icon="download" disabled={busy} onClick={backup}>Export backup</Button>
            {canEdit && <label className="import-label"><Icon name="upload"/>Import backup<input type="file" accept=".json" onChange={e=>{restore(e.target.files[0]);e.target.value="";}}/></label>}
          </div>
        </div>
      </details>}
      <div className="studio-main">
        <div className="main-content" inert={busy ? true : undefined}>
          <header className="page-header">
            <div>
              <div className="page-eyebrow">SOUND DESIGN · {r.page === "new" ? "NEW GAME" : r.page === "list" ? "EDIT LIST" : r.page === "library" ? "FILES" : r.page === "saved" ? "SAVED SPECS" : "SOUND SPECS"}</div>
              <div className="game-heading">
                {["editor", "viewer", "list"].includes(r.page) ? (
                  <GamePicker
                    games={saved.games}
                    selectedId={game.id}
                    onSelect={(id) => go(r.page, id)}
                  />
                ) : (
                  <h1>
                    {r.page === "new" ? "New Game" : r.page === "library"
                      ? "Uploaded files"
                      : "Saved sound lists"}
                  </h1>
                )}
              </div>
              <p>
                {r.page === "new" ? "Start a sound list or import a spreadsheet." : r.page === "list" ? "Edit multiple sounds together. Save as Draft or Final." : r.page === "editor"
                  ? "Editing selected cue · Save or cancel in the Inspector"
                  : r.page === "viewer"
                    ? `${game.cues.length} sound cues · ${new Set(game.cues.flatMap(cueAudioIds)).size} audio · ${new Set(game.cues.flatMap(c=>cueVideos(c).map(v=>v.url))).size} video`
                    : r.page === "library"
                      ? "Audio and video supplied by editors and creators."
                      : "One maintained sound list for each game."}
              </p>
              {["viewer", "editor", "list"].includes(r.page) && game.specStatus && <span className={"status spec-stage spec-stage-" + game.specStatus}>{game.specStatus === "draft" ? "Draft" : "Final"}</span>}
              {["viewer", "editor", "list"].includes(r.page) && <div className="spec-header-credit"><AuditDetails record={game} /></div>}
            </div>
            <div className="actions">
              {["viewer","editor","list"].includes(r.page) && <>
                <Button icon="download" disabled={r.page !== "viewer"} onClick={() => csv()}>Spreadsheet</Button>
                <Button icon="link" disabled={r.page !== "viewer"} onClick={() => share()}>Share link</Button>

              </>}
            </div>
          </header>
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {r.page === "viewer" && game.workingDraft && <div className="saved-draft-notice" role="status"><div><strong>Draft saved</strong><span>{game.cues.length ? 'Unfinished edits are kept separately from this saved list.' : 'This spec is still being prepared.'}</span></div>{canEdit && <div className="actions"><Button onClick={async()=>{
            if(!confirm('Discard the saved draft? The current sound list will be kept.')) return;
            const {workingDraft,...withoutDraft}=game;
            await save({...saved,games:saved.games.map(g=>g.id===game.id ? withoutDraft : g)});
          }}>Discard draft</Button><Button kind="primary" icon="edit" onClick={()=>go('list',game.id)}>Resume draft</Button></div>}</div>}
          {["new", "list"].includes(r.page) && (canEdit ? <NewGame key={r.page + ':' + (game?.id || 'new')} initialGame={r.page === 'list' ? game : null} assets={saved.assets} referenceCatalog={saved.games.flatMap(g=>g.cues.map(c=>c.libraryReference).filter(Boolean))} onDirty={setNewGameDirty} busy={busy}
            onCancel={() => newGameDirty ? setModal('cancel-list') : go('viewer')}
            onSave={prepare => {
              if (!canEdit) return;
              setPendingSpecSave({prepare: specStatus => {
                const {game:nextGame,assets} = prepare(specStatus);
                return {gameId:nextGame.id,next:{...saved,games:r.page === "list" ? saved.games.map(g=>g.id===game.id ? nextGame : g) : [...saved.games,nextGame],assets:[...saved.assets,...assets]}};
              }});
            }}/>: <p>An Editor or Admin role is required to edit sound lists.</p>)}
          {["viewer", "editor"].includes(r.page) && (
            <Viewer
              key={game.id}
              game={game} assets={r.page === "editor" ? draft.assets : saved.assets}
              selected={selected} onSelect={setSelected}
              canEdit={canEdit} canStatus={canStatus} editing={r.page === "editor"}
              onEdit={() => go("editor")}
              onAdd={addCue}
              onEditList={() => go("list",game.id)}
              onDuplicate={duplicate} onDelete={remove}
              onCancel={() => {setDraft(structuredClone(saved));setR({...r,page:"viewer"});location.hash=new URLSearchParams({page:"viewer",game:game.id});}}
              onSave={() => {if(!mediaBusy)setPendingSpecSave({gameId:game.id,next:draft});}}
              onStatus={async (id, status) => {
                if(!canStatus) return;
                await save({...saved, games:saved.games.map(g=>g.id===game.id ? {...g,cues:g.cues.map(c=>c.id===id ? {...c,status} : c)} : g)});
              }}
              mediaBusy={mediaBusy}
              editorPanel={<Editor onBusyChange={setMediaBusy} onMediaChange={(cue,added)=>setDraft(current=>({...current,assets:[...current.assets,...added],games:current.games.map(g=>g.id===game.id?{...g,cues:g.cues.map(c=>c.id===cue.id?cue:c)}:g)}))} referenceCatalog={saved.games.flatMap(g=>g.cues.map(c=>c.libraryReference).filter(Boolean))} compact game={game} assets={draft.assets} videos={draft.videos || []} selected={selected} onSelect={setSelected}
                onChange={c=>updateGame(g=>({...g,cues:g.cues.map(x=>x.id===c.id ? c : x)}))}
                onAddAsset={()=>setModal("asset")}/>}
            />
          )}
          {r.page === "library" && (
            <Library
              assets={draft.assets}
              videos={[
                ...(draft.videos || []),
                ...new Map(
                  draft.games.flatMap((g) =>
                    g.cues.flatMap(c=>cueVideos(c).map(v=>[
                      v.url,{id:v.url,name:v.name || c.name+' video',videoUrl:v.url,category:'Video',sourceGame:g.name,tags:[],...v.audit}
                    ])),
                  ),
                ).values(),
              ]}
              standalone
              canUpload={canEdit}
              onDelete={(file,type)=>setPendingFileDelete({file,type})}
              onAdd={(type) => setModal(type === "video" ? "video" : "asset")}
            />
          )}{" "}
          {r.page === "saved" && (
            <div className="saved-grid">
              {saved.games.map((g) => {
                const displayedRows = g.workingDraft ? g.workingDraft.rows.filter(hasDraftContent) : g.cues;
                const linkedAudio = new Set(
                  displayedRows.flatMap(c=>g.workingDraft ? rowFiles(c,"audio",saved.assets).map(f=>f.assetId || f.url) : cueAudioIds(c)).filter(Boolean),
                ).size;
                const videoCount = new Set(
                  displayedRows.flatMap(c=>g.workingDraft ? rowFiles(c,"video").map(f=>f.url) : cueVideos(c).map(v=>v.url)).filter(Boolean),
                ).size;
                const implemented = g.cues.filter(
                  (c) => c.status === "Implemented",
                ).length;
                return (
                  <article
                    className="saved-card"
                    key={g.id}
                    aria-label={g.name + " saved spec"}
                  >
                    <div className="saved-card-top">
                      <span className="game-monogram" aria-hidden="true">
                        {g.iconUrl ? <img src={g.iconUrl} alt=""/> : g.name
                          .split(/\s+/)
                          .map((w) => w[0])
                          .slice(0, 3)
                          .join("")}
                      </span>
                      <span
                        className={
                          "status " +
                          (g.cues.length && implemented === g.cues.length
                            ? "status-implemented"
                            : "status-in-review")
                        }
                      >
                        {g.workingDraft || g.specStatus === 'draft' ? 'Draft' : g.specStatus === 'final' ? 'Final' : g.cues.length
                          ? implemented === g.cues.length
                            ? "Implemented"
                            : "In progress"
                          : "Empty spec"}
                      </span>
                    </div>
                    <div className="saved-card-heading">
                      <div className="saved-card-title"><h2>{g.name}</h2><AuditDetails record={g} /></div>
                      {canEdit && <div className="saved-card-edit-actions"><Button
                        icon="edit"
                        aria-label={"Rename " + g.name}
                        disabled={busy}
                        onClick={() => renameSpec(g)}
                      >Rename</Button>
                      <GameIconUpload label="Change icon" ariaLabel={"Change icon for " + g.name} disabled={busy} onChange={async iconUrl => {
                        if (!await save({...saved,games:saved.games.map(x => x.id === g.id ? {...x,iconUrl} : x)})) throw Error('Could not save the icon. Please try again.');
                      }}/></div>}
                    </div>
                    {g.workingDraft && <p className="saved-card-subtitle">Unfinished edits · resume to continue</p>}
                    <div className="saved-card-counts">
                      <span>
                        <strong>{displayedRows.length}</strong>Sound cues
                      </span>
                      <span>
                        <strong>{linkedAudio}</strong>Audio files
                      </span>
                      <span>
                        <strong>{videoCount}</strong>Videos
                      </span>
                    </div>
                    <div className="saved-card-actions">
                      <Button icon="eye" onClick={() => go("viewer", g.id)}>
                        Open
                      </Button>
                      {canEdit ? <><Button
                        icon="edit"
                        kind="primary"
                        onClick={() => go("list", g.id)}
                      >
                        {g.workingDraft ? 'Resume draft' : 'Edit list'}
                      </Button>
                      <Button icon="copy" disabled={!canEdit} onClick={() => duplicateSpec(g)}>
                        Duplicate
                      </Button>
                      <Button
                        icon="trash"
                        kind="danger"
                        aria-label={"Delete " + g.name}
                        onClick={() => deleteSpec(g)}
                      /></> : <>
                        <Button icon="link" onClick={() => share(g)}>Share link</Button>
                        <Button icon="download" onClick={() => csv(g)}>Spreadsheet</Button>
                      </>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {message && (
        <div className="toast" role="status">
          <Icon name="check" />
          {message}
          {fileUndo && canEdit && <Button disabled={busy || dirty} onClick={async()=>{if(await save({...fileUndo,revision:saved.revision})) setMessage("File and attachments restored.");}}>Undo</Button>}
          {fileUndo && <Button aria-label="Dismiss notification" onClick={()=>{setFileUndo(null);setMessage("");}}>Dismiss</Button>}
        </div>
      )}
      {pendingSpecSave && <Modal title="Is this the final spec?" onClose={()=>!busy && setPendingSpecSave(null)}>
        <p>Both options save your latest work to Sound Specs. Choose Draft if you are still working on it.</p>
        <p className="muted">Draft only requires a game title. Final also requires a Sound ID for each filled row. Sound implementation statuses stay unchanged.</p>
        {error && <p role="alert" className="error-banner">{error}</p>}
        <div className="file-delete-actions">
          <Button disabled={busy} onClick={()=>confirmSpecSave('draft')}>No, save as draft</Button>
          <Button kind="primary" disabled={busy} onClick={()=>confirmSpecSave('final')}>Yes, save as final</Button>
        </div>
      </Modal>}
      {modal === 'cancel-list' && <Modal title="Discard unsaved list edits?" onClose={()=>setModal(null)}>
        <p>Your last saved list and any saved draft will be kept.</p>
        <div className="file-delete-actions"><Button onClick={()=>setModal(null)}>Keep editing</Button><Button kind="danger" onClick={()=>{
          setNewGameDirty(false);setModal(null);approvedNavigation.current=true;
          const next={page:'viewer',game:game.id};setR(next);location.hash=new URLSearchParams(next);
        }}>Discard unsaved edits</Button></div>
      </Modal>}
      {pendingFileDelete && <Modal title={`Delete ${pendingFileDelete.type} file?`} onClose={()=>!busy && setPendingFileDelete(null)}>
        <p><strong>{pendingFileDelete.file.name}</strong></p>
        <p>This removes the file from this demo and detaches it from the cues below. The cues and the original source file are kept.</p>
        <ul>{fileUsages(saved,pendingFileDelete.file,pendingFileDelete.type).map((use,i)=><li key={i}>{use.game} · {use.cue}</li>)}</ul>
        {!fileUsages(saved,pendingFileDelete.file,pendingFileDelete.type).length && <p>No cues use this file.</p>}
        <div className="file-delete-actions"><Button disabled={busy} onClick={()=>setPendingFileDelete(null)}>Cancel</Button><Button kind="danger" icon="trash" disabled={busy || !canEdit} onClick={async()=>{
          const previous=structuredClone(saved);
          if(await save(removeUploadedFile(saved,pendingFileDelete.file,pendingFileDelete.type))) {
            setFileUndo(previous);setPendingFileDelete(null);setMessage("File removed from the demo.");
          }
        }}>Delete file</Button></div>
      </Modal>}
      {(modal === "asset" || modal === "video") && (
        <AssetModal
          mediaType={modal === "video" ? "video" : "audio"}
          standalone={r.page === "library"}
          onClose={() => setModal(null)}
          onCreate={async (a) => {
            if (modal === "video") {
              if (await save({ ...draft, videos: [...(draft.videos || []), a] })) setModal(null);
              else throw Error("Could not save the video. Please try again.");
              return;
            }
            const next = { ...draft, assets: [...draft.assets, a] };
            if (r.page === "editor") {
              setDraft({
                ...next,
                games: next.games.map((g) =>
                  g.id === game.id
                    ? {
                        ...g,
                        cues: g.cues.map((c) =>
                          c.id === selected ? setCueAudio(c,[...cueAudioIds(c),a.id]) : c,
                        ),
                      }
                    : g,
                ),
              });
              setModal(null);
              setMessage(
                "Sound attached to draft. Save the sound list to keep it.",
              );
            } else if (await save(next)) setModal(null);
          }}
        />
      )}
    </div></div>, {page:r.page, go, canEdit}
  );
}
function AssetModal({ onClose, onCreate, mediaType = "audio", standalone = false }) {
  const isVideo = mediaType === "video";
  const [values, setValues] = useState({
      name: "",
      category: "UI",
      tags: "",
      sourceGame: "",
      audioUrl: "",
      libraryId: "",
      libraryUrl: "",
    }),
    [file, setFile] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const input = (key) => ({
    value: values[key],
    onChange: (e) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  return (
    <Modal title={`Upload ${mediaType}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (!file && !safeUrl(values.audioUrl))
              throw Error(
                `Choose ${isVideo ? "a video" : "an audio"} file or enter an http/https ${mediaType} URL.`,
              );
            if (values.libraryUrl && !safeUrl(values.libraryUrl))
              throw Error("Enter a valid library link.");
            if (file) validateMediaFile(file, mediaType);
            let url = values.audioUrl;
            if (file) url = (await repository.upload(file)).url;
            await onCreate({
              ...values,
              id: crypto.randomUUID(),
              name: values.name.trim(),
              audioUrl: isVideo ? undefined : url,
              ...(isVideo ? { videoUrl: url, category: "Video" } : {}),
              tags: values.tags
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              origin: "local",
            });
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={isVideo ? "Video name" : "Sound name"}>
          <input autoFocus required {...input("name")} />
        </Field>
        <div className="form-row two">
          {!isVideo && <Field label="Type">
            <select {...input("category")}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>}
          <Field label="Tags (comma separated)">
            <input placeholder="Sparkly, Bright" {...input("tags")} />
          </Field>
        </div>
        <Field label={`Upload ${mediaType} (up to 50 MB)`}>
          <input
            type="file"
            accept={isVideo ? ".mp4,.webm,.mov" : ".wav,.mp3,.ogg,.m4a"}
            onChange={(e) => {
              const chosen = e.target.files[0];
              setError("");
              if (chosen) {
                try { validateMediaFile(chosen, mediaType); }
                catch (error) { setError(error.message); setFile(null); e.target.value = ""; return; }
              }
              setFile(chosen);
              if (!values.name && e.target.files[0])
                setValues((v) => ({
                  ...v,
                  name: e.target.files[0].name.replace(/\.[^.]+$/, ""),
                }));
            }}
          />
        </Field>
        <Field label={`Or direct ${mediaType} URL`}>
          <input
            type="url"
            disabled={!!file}
            placeholder={isVideo ? "https://…/preview.mp4" : "https://…/sound.wav"}
            {...input("audioUrl")}
          />
        </Field>
        <Field label="Source game">
          <input {...input("sourceGame")} />
        </Field>
        <p className="muted">
          {isVideo ? "Add a gameplay or animation preview to Uploaded files." : "This audio is the creator’s deliverable. Cerberator references are set separately on the cue."}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button kind="primary" disabled={busy}>
          {busy ? "Adding…" : standalone ? `Add ${mediaType}` : "Attach audio"}
        </Button>
      </form>
    </Modal>
  );
}
