"use client";

import { useEffect } from "react";
import { StatusPage } from "@/components/ui/StatusPage";

/**
 * Shown when a page throws while rendering. Never shows the error itself: in
 * production Next replaces a server error's message with a digest, and a stack
 * trace is no use to a couple. The digest goes to the browser console so it can
 * be matched to the server log.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[vowlet] Page error", error.digest ?? "", error);
  }, [error]);

  return (
    <StatusPage
      heading="Something went wrong"
      actions={
        <button type="button" className="btn btn-secondary" onClick={() => retry()}>
          Try again
        </button>
      }
    >
      <p>That page couldn&apos;t load. Try again, or head back to the dashboard.</p>
      {error.digest && <p className="text-xs">Reference: {error.digest}</p>}
    </StatusPage>
  );
}
