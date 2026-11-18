import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <Card className="not-found" aria-labelledby="missing-title">
      <p className="caption-3 technical">404</p>
      <h1 id="missing-title" className="heading-4">Page not found</h1>
      <p className="body-6 muted">This page is unavailable in your ClipFlow workspace.</p>
      <Link className={buttonVariants({ variant: "primary" })} href="/">Back to overview</Link>
    </Card>
  );
}
