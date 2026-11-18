import type { ReactNode } from "react";

export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <div className="empty-copy">
        <p className="title-4">{title}</p>
        <p className="caption-5 muted">{description}</p>
      </div>
    </div>
  );
}
