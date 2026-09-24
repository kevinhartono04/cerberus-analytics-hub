"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import type { GeneratedSpec } from "@/lib/types";

export default function DownloadSpecButton({ spec }: { spec: GeneratedSpec }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setDownloading(true);
    setError("");
    try {
      const response = await fetch("/api/export/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      if (!response.ok) throw new Error("Could not download the spreadsheet. Please try again.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${spec.intake.gameTitle.replace(/[\\/:*?"<>|\r\n]/g, "_") || "analytics-spec"}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download the spreadsheet.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={download} disabled={downloading}
        className="focus-ring inline-flex h-11 items-center gap-2 rounded-[10px] border border-line/70 bg-surface-raised px-4 text-sm font-semibold text-text-muted hover:bg-surface-hover disabled:opacity-50">
        <Download className="h-4 w-4" />
        {downloading ? "Downloading…" : "Download Spreadsheet"}
      </button>
      {error ? <p role="alert" className="mt-2 max-w-xs text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
