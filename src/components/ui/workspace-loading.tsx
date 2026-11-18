export function WorkspaceLoading() {
  return <div className="overview" role="status" aria-label="Loading workspace">
    <div className="workspace-skeleton skeleton-title" aria-hidden="true" />
    <div className="workspace-skeleton skeleton-toolbar" aria-hidden="true" />
    <div className="workspace-skeleton skeleton-panel" aria-hidden="true" />
  </div>;
}
