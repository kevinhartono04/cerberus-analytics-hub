import type { ReactNode } from "react";

export interface WorkspaceNavigation {
  page: string;
  go: (page: string, game?: string) => void;
  canEdit: boolean;
}
export interface WorkspaceProps {
  user?: {id:string;name:string;email:string;role:string};
  renderShell: (content: ReactNode, navigation: WorkspaceNavigation) => ReactNode;
}
export default function Workspace(props: WorkspaceProps): ReactNode;
