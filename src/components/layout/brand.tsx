import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="ClipFlow overview">
      <span className="brand-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
          <path d="M3.5 6.5h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-10Z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.5 4h12a2 2 0 0 1 2 2v8M9 9.5v6l5-3-5-3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="brand-copy"><span className="title-3">ClipFlow</span><span className="caption-5">One clip. Every channel.</span></span>
    </Link>
  );
}
