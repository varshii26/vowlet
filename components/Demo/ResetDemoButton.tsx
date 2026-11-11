"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

const successSchema = z.object({ ok: z.literal(true), message: z.string() });
const failureSchema = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });

const NETWORK = "Couldn't reach Vowlet. Check your connection and try again.";
const UNEXPECTED = "Something unexpected happened. Please try again.";

type Notice = { tone: "info" | "error"; text: string };

/**
 * Puts the demo back to its starting state (POST /api/demo/reset), after an
 * inline confirmation. For judges and rehearsals: it wipes payments, proposals
 * and date changes made in the app.
 */
export function ResetDemoButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function reset() {
    setBusy(true);
    setNotice(null);
    let json: unknown;
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      json = await res.json().catch(() => null);
    } catch {
      json = undefined;
    }
    setBusy(false);
    setConfirming(false);

    const success = successSchema.safeParse(json);
    if (success.success) {
      setNotice({ tone: "info", text: success.data.message });
      router.refresh(); // every section re-renders from the reseeded database
      return;
    }
    const failure = failureSchema.safeParse(json);
    setNotice({ tone: "error", text: json === undefined ? NETWORK : failure.success ? failure.data.error.message : UNEXPECTED });
  }

  return (
    <div className="relative flex flex-col items-end gap-1 text-sm">
      {confirming ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="max-w-xs text-right text-muted">Reset Priya &amp; Sam&apos;s demo to its starting state? Payments and changes made here are undone.</span>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="btn bg-red-600 text-white hover:bg-red-700"
          >
            {busy ? "Resetting..." : "Yes, reset"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="btn btn-secondary"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setConfirming(true);
          }}
          className="btn btn-secondary"
        >
          Reset demo
        </button>
      )}
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={"absolute right-0 top-full mt-1 w-max max-w-xs text-right " + (notice.tone === "error" ? "text-red-700" : "text-muted")}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
