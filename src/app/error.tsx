"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <Card className="not-found">
    <h1 className="heading-4">Workspace unavailable</h1>
    <p className="body-6 muted">Check that the local database and storage directory are accessible, then try again.</p>
    <Button onClick={reset}>Try again</Button>
  </Card>;
}
