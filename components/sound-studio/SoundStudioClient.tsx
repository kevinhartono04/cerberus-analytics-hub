"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import CerberusShell, { type SoundStudioPage } from "@/components/CerberusShell";
import type { WorkspaceNavigation } from "./workspace/Workspace";
import "./sound-studio.css";

// Retain the tested prototype as a self-contained JS module with a typed host
// boundary. Its browser APIs must not execute during server rendering.
const Workspace = dynamic(() => import("./workspace/Workspace"), {
  ssr: false,
  loading: () => <p className="p-8 text-sm text-text-muted" role="status">Loading Sound Studio…</p>,
});

export default function SoundStudioClient({user}:{user:{id:string;name:string;email:string;role:string}}) {
  const [collapsed, setCollapsed] = useState(false);
  function renderShell(content: ReactNode, navigation: WorkspaceNavigation) {
    const page: SoundStudioPage = ["saved", "library", "new"].includes(navigation.page)
      ? navigation.page as SoundStudioPage : "viewer";
    return <CerberusShell currentProduct="sound-studio" collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed(value => !value)} contentClassName="max-w-none"
      soundNavigation={{ active: page, canCreate: navigation.canEdit, onChange: navigation.go }}>
      {content}
    </CerberusShell>;
  }
  return <Workspace renderShell={renderShell} user={user} />;
}
