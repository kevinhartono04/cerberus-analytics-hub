import React, { useState } from "react";
import { searchAssets } from "../adapters/repository";
import { AudioPreview, VideoPreview } from "./Media";
import { Button, Empty, FileCredit, Icon, categoryKey } from "./ui";
import DownloadFiles from "./DownloadFiles";
export default function Library({
  assets,
  videos = [],
  onAttach,
  onAdd,
  onDelete,
  selectedId,
  standalone = false,
  canUpload = true,
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [mediaType, setMediaType] = useState("audio");
  const files = standalone && mediaType === "video" ? videos : assets;
  const result = searchAssets(files, search, standalone && mediaType === "video" ? "" : category);
  function selectTab(type) {
    setMediaType(type);
    setCategory("");
  }
  const uploadButton = canUpload && <Button icon="upload" onClick={() => {
    setSearch("");
    setCategory("");
    onAdd(standalone ? mediaType : "audio");
  }}>Upload {standalone ? mediaType : "audio"}</Button>;
  return (
    <section className={"library" + (standalone ? " uploaded-library" : "")}>
      {!standalone && <div className="section-heading">
        <div>
          <h3>{standalone ? "Uploaded files" : "Creator audio files"}</h3>
          <p className="muted">
            {standalone
              ? "Audio and video supplied by editors and creators. Each file shows when it was added and by whom."
              : "Upload the audio for this cue, or reuse an existing creator file."}
          </p>
        </div>
        {uploadButton}
      </div>}
      {standalone && (
        <div className="library-toolbar">
        <div className="category-strip library-tabs" role="tablist" aria-label="Uploaded file type">
          <span className="category-strip-label">FILE<br/>TYPES</span>
          {["audio", "video"].map((type, index) => (
            <button
              key={type}
              data-category={type}
              id={`uploaded-${type}-tab`}
              role="tab"
              aria-selected={mediaType === type}
              aria-controls="uploaded-files-panel"
              tabIndex={mediaType === type ? 0 : -1}
              className={mediaType === type ? "active" : ""}
              onClick={() => selectTab(type)}
              onKeyDown={(event) => {
                const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
                selectTab(["audio", "video"][next]);
                event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
              }}
            >
              <strong><span aria-hidden="true">▪</span> {type === "audio" ? "Audio" : "Video"}</strong>
              <small>{type === "audio" ? assets.length : videos.length} files</small>
            </button>
          ))}
        </div>
        <div className="actions"><DownloadFiles files={files.map(file=>({url:file.videoUrl || file.audioUrl,name:file.name,type:mediaType}))} name={'Uploaded '+mediaType}/>{uploadButton}</div>
        </div>
      )}
      <div
        id={standalone ? "uploaded-files-panel" : undefined}
        role={standalone ? "tabpanel" : undefined}
        aria-labelledby={standalone ? `uploaded-${mediaType}-tab` : undefined}
      >
      <div className="library-filters">
        <input
          aria-label={standalone ? `Search ${mediaType} files` : "Search library sounds"}
          placeholder={standalone ? `Search ${mediaType} files, tags, games…` : "Search sounds, tags, games…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {(!standalone || mediaType === "audio") && <select
          aria-label={standalone ? "Filter file category" : "Filter sound type"}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All types</option>
          {[
            ...new Set(
              files.map((a) => a.category).filter(Boolean),
            ),
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>}
      </div>
      <div className="asset-list">
        {result.map((a) => (
          <div
            className={"asset-row" + (standalone ? " asset-with-audit" : "")}
            key={a.id}
          >
            <div className="asset-info">
              <strong>{a.name}</strong>
              {!standalone && <FileMetadata asset={a} />}
              <FileCredit record={a} />
            </div>
            {standalone && <FileMetadata asset={a} />}
            {a.videoUrl ? (
              <VideoPreview url={a.videoUrl} />
            ) : (
              <AudioPreview asset={a} compact />
            )}
            {standalone && (<div className="file-actions">
              <a
                className="button file-download"
                href={downloadUrl(a.videoUrl || a.audioUrl)}
                download={
                  (/^(\/|data:)/.test(a.videoUrl || a.audioUrl))
                    ? downloadName(a)
                    : undefined
                }
                target={
                  (/^(\/|data:)/.test(a.videoUrl || a.audioUrl))
                    ? undefined
                    : "_blank"
                }
                rel="noreferrer"
                aria-label={"Download " + a.name}
                title={
                  (/^(\/|data:)/.test(a.videoUrl || a.audioUrl))
                    ? "Download original file"
                    : "Download from source; access and provider permissions apply"
                }
              >
                <Icon name="download" />
                Download
              </a>
              {canUpload && onDelete && <Button icon="trash" kind="danger" aria-label={"Delete " + a.name} onClick={()=>onDelete(a,mediaType)}>Delete</Button>}
              </div>
            )}
            {onAttach && (
              <Button
                icon={a.id === selectedId ? "check" : "link"}
                onClick={() => onAttach(a.id)}
              >
                {a.id === selectedId ? "Attached" : "Attach"}
              </Button>
            )}
          </div>
        ))}
        {!result.length && <Empty>{standalone ? (files.length ? `No ${mediaType} files match these filters.` : `No ${mediaType} files added yet.`) : "No sounds match these filters."}</Empty>}
      </div>
      </div>
    </section>
  );
}

export function downloadUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "drive.google.com") {
      const id =
        parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
        parsed.searchParams.get("id");
      if (id)
        return (
          "https://drive.google.com/uc?export=download&id=" +
          encodeURIComponent(id)
        );
    }
  } catch {
    /* Local uploaded files use relative URLs. */
  }
  return url;
}

export function downloadName(asset) {
  const url = asset.videoUrl || asset.audioUrl;
  const extension = url.split("/").pop().match(/\.[a-z0-9]+$/i)?.[0] || "";
  const name = asset.name.replace(/[\/\\:*?"<>|]/g, "_");
  return extension && !name.toLowerCase().endsWith(extension.toLowerCase()) ? name + extension : name;
}

function FileMetadata({ asset }) {
  return <div className="asset-metadata">
    <small>{asset.sourceGame || "Local upload"} · <span className="category-tag" data-category={categoryKey(asset.category)}>{asset.category || "Uncategorized"}</span></small>
    {!!asset.tags?.length && <div className="tags">{asset.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
  </div>;
}
