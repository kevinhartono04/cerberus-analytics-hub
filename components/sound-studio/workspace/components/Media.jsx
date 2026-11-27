import React, { useEffect, useRef, useState } from "react";
import { videoKind } from "../model";
import { Icon } from "./ui";
const waves = new Map();
const timeLabel = (n) =>
  Number.isFinite(n)
    ? n < 1
      ? n.toFixed(2) + "s"
      : Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0")
    : "0:00";
function NativeAudioPreview({ asset, compact = false }) {
  const player = useRef(null);
  const [bars, setBars] = useState([]),
    [error, setError] = useState(""),
    [playing, setPlaying] = useState(false),
    [duration, setDuration] = useState(0),
    [time, setTime] = useState(0),
    [details, setDetails] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setError("");
    setBars([]);
    setDetails(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    if (!asset?.audioUrl) return;
    if (waves.has(asset.audioUrl)) {
      const cached = waves.get(asset.audioUrl);
      setBars(cached.bars);
      setDetails(cached.details);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      let ctx;
      try {
        const response = await fetch(asset.audioUrl, { signal: ctrl.signal });
        if (!response.ok) throw Error();
        const buffer = await response.arrayBuffer();
        const fileSize = buffer.byteLength;
        ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buffer);
        const d = audio.getChannelData(0),
          count = 56,
          step = Math.max(1, Math.floor(d.length / count));
        const b = Array.from({ length: count }, (_, i) => {
          let sum = 0;
          for (let j = i * step; j < Math.min((i + 1) * step, d.length); j++)
            sum += d[j] * d[j];
          return Math.sqrt(sum / step);
        });
        const max = Math.max(...b, 0.001),
          normalized = b.map((v) => v / max),
          meta = { channels: audio.numberOfChannels, size: fileSize };
        waves.set(asset.audioUrl, { bars: normalized, details: meta });
        if (!cancelled) {
          setBars(normalized);
          setDetails(meta);
        }
      } catch {
      } finally {
        ctx?.close();
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [asset?.audioUrl]);
  if (!asset) return null;
  async function toggle() {
    try {
      if (player.current.paused) await player.current.play();
      else player.current.pause();
    } catch {
      setError("Audio could not play. Check the URL or file access.");
    }
  }
  return (
    <div className={"audio-preview " + (compact ? "compact" : "")}>
      <div className="audio-visual">
        <button type="button"
          className="audio-play"
          aria-label={(playing ? "Pause " : "Play ") + asset.name}
          onClick={toggle}
        >
          <Icon name={playing ? "pause" : "play"} size={14}/>
        </button>
        <div className="waveform" aria-hidden="true">
          {bars.map((b, i) => (
            <span
              key={i}
              style={{
                height: Math.max(2, b * (compact ? 25 : 42)) + "px",
                opacity: time / duration > i / bars.length ? 1 : 0.65,
              }}
            />
          ))}
        </div>
      </div>
      <div className="audio-time">
        <span>{timeLabel(time)}</span>
        <span>{timeLabel(duration)}</span>
      </div>
      <input
        className="audio-seek"
        type="range"
        min="0"
        max={duration || 1}
        step="0.01"
        value={time}
        disabled={!duration}
        aria-label={"Seek " + asset.name}
        onChange={(e) => {
          player.current.currentTime = Number(e.target.value);
          setTime(Number(e.target.value));
        }}
      />
      <audio
        ref={player}
        key={asset.audioUrl}
        preload="metadata"
        src={asset.audioUrl}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        onTimeUpdate={(e) => setTime(e.target.currentTime)}
        onPlay={(e) => {
          setPlaying(true);
          document.querySelectorAll("audio,video").forEach((a) => {
            if (a !== e.target) a.pause();
          });
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() =>
          setError("Audio could not load. Check the URL or file access.")
        }
      />
      {!compact && details && (
        <div className="audio-meta">
          <span>
            {details.channels === 1
              ? "Mono"
              : details.channels === 2
                ? "Stereo"
                : details.channels + " channels"}
          </span>
          <span>{Math.round(details.size / 1024)} KB</span>
          <span>{(asset.name.match(/\.(wav|mp3|ogg|m4a)$/i)?.[1] || asset.audioUrl.match(/^data:audio\/([^;]+)/)?.[1] || "Audio").toUpperCase()}</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
export function VideoPreview({ url, showHeading = true }) {
  const [embeddedUrl, setEmbeddedUrl] = useState("");
  useEffect(() => {
    if (!url?.startsWith("data:")) { setEmbeddedUrl(""); return; }
    let active = true, objectUrl;
    fetch(url).then(response => response.blob()).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setEmbeddedUrl(objectUrl);
    }).catch(() => setError(true));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [url]);
  if (!url) return null;
  const media = videoKind(url);
  return (
    <section className="video-section">
      {showHeading && <h4>Video preview</h4>}
      {media.kind === "video" ? (
        <video
          controls
          key={url}
          src={(url.startsWith("data:") ? embeddedUrl : url) || undefined}
          onError={() => setError(true)}
          preload="metadata"
        />
      ) : media.kind === "embed" ? (
        loaded ? (
          <iframe
            title="Gameplay video preview"
            src={media.url}
            allow="fullscreen; autoplay"
            allowFullScreen
          />
        ) : (
          <button type="button" className="video-load" onClick={() => setLoaded(true)}>
            <Icon name="external" />
            Load video preview
          </button>
        )
      ) : (
        <p className="muted">Open the source to watch this video.</p>
      )}
      {media.kind === "embed" && (
        <small className="media-access-note">
          Playback requires access to the source file.
        </small>
      )}
      {error && (
        <p className="error">
          Preview unavailable. Check the file format or source access.
        </p>
      )}
      {url.startsWith("data:") ? <small>Uploaded preview · Saved with this browser’s demo copy</small> : <a href={url} target="_blank" rel="noreferrer">
        Open video source <Icon name="external" size={12} />
      </a>}
    </section>
  );
}

export function AudioPreview({
  asset,
  compact = false,
  onPreview,
  forceLoad = false,
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [asset?.id]);
  const drive = asset?.audioUrl?.match(
    /^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/,
  );
  if (!drive) return <NativeAudioPreview asset={asset} compact={compact} />;
  return (
    <div className={"drive-audio " + (compact ? "compact" : "")}>
      {!compact && (loaded || forceLoad) ? (
        <iframe
          title={"Audio preview: " + asset.name}
          src={"https://drive.google.com/file/d/" + drive[1] + "/preview"}
          allow="autoplay"
        />
      ) : (
        <div className="audio-visual drive-audio-control">
          <button type="button"
            className="audio-play"
            aria-label={"Open audio player for " + asset.name}
            title="Open Drive player; file access is required"
            onClick={(e) => {
              e.stopPropagation();
              if (compact && onPreview) onPreview();
              else setLoaded(true);
            }}
          >
            <Icon name="play" size={14}/>
          </button>
          <div className="waveform-unavailable">
            <span aria-hidden="true" />
            <small>Preview in Drive</small>
          </div>
        </div>
      )}
      {compact && !onPreview && loaded && (
        <iframe
          title={"Audio preview: " + asset.name}
          src={"https://drive.google.com/file/d/" + drive[1] + "/preview"}
          allow="autoplay"
        />
      )}
      {!compact && (
        <small>Google Drive access is required to play this source file.</small>
      )}
    </div>
  );
}
