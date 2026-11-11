"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ReviewForm } from "@/components/Upload/ReviewForm";
import { requestConfirm, requestExtraction, type ExtractedTermsView } from "@/lib/upload/client";
import type { ReviewedContract } from "@/lib/upload/schema";

type ItemState =
  | { status: "queued" }
  | { status: "extracting" }
  | { status: "error"; message: string }
  | { status: "review"; terms: ExtractedTermsView }
  | { status: "saved"; vendorId: string; message: string };

type Item = { id: number; file: File; state: ItemState };

const looksLikePdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Pick one or more contract PDFs; each gets its own review card. Files are read
 * one after another (extraction is rate limited), and one failing never stops
 * the others. Nothing is saved until the couple confirms a card.
 */
export function UploadContracts() {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(1);
  // Extractions run one at a time, in the order the files were added.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [today] = useState(todayIso);

  const update = (id: number, state: ItemState) => setItems((all) => all.map((i) => (i.id === id ? { ...i, state } : i)));

  function enqueue(item: Item) {
    queue.current = queue.current.then(async () => {
      update(item.id, { status: "extracting" });
      const result = await requestExtraction(item.file);
      update(item.id, result.ok ? { status: "review", terms: result.terms } : { status: "error", message: result.message });
    });
  }

  function addFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    const added: Item[] = files.map((file) => ({
      id: nextId.current++,
      file,
      state: looksLikePdf(file) ? { status: "queued" } : { status: "error", message: "That file isn't a PDF." },
    }));
    setItems((all) => [...all, ...added]);
    for (const item of added) if (item.state.status === "queued") enqueue(item);
  }

  async function confirm(item: Item, review: ReviewedContract): Promise<string | null> {
    const result = await requestConfirm(item.file, review);
    if (!result.ok) return result.message;
    update(item.id, { status: "saved", vendorId: result.vendorId, message: result.message });
    return null;
  }

  const savedCount = items.filter((i) => i.state.status === "saved").length;

  return (
    <div className="space-y-6">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-accent/40 bg-accent-soft p-8 text-center hover:border-accent/40 hover:bg-accent-soft">
        <span className="text-base font-medium">Choose vendor contracts (PDF)</span>
        <span className="text-sm text-muted">You can pick several. Each one is read by AI, then shown here for you to check before anything is saved.</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          aria-label="Contract PDFs"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ""; // allow picking the same file again
          }}
        />
      </label>

      {savedCount > 0 && (
        <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {savedCount === 1 ? "1 vendor was" : `${savedCount} vendors were`} added.{" "}
          <Link href="/" className="font-medium underline">
            See them on the timeline
          </Link>
        </p>
      )}

      {items.map((item) => (
        <article key={item.id} className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" aria-label={item.file.name}>
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{item.file.name}</h3>
            <StatusBadge state={item.state} />
          </header>

          {item.state.status === "queued" && <p className="text-sm text-muted">Waiting for the previous contract to finish...</p>}
          {item.state.status === "extracting" && (
            <p className="text-sm text-muted" aria-live="polite">
              Reading the contract and checking every quote against the PDF. This takes about half a minute...
            </p>
          )}
          {item.state.status === "error" && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              <span>{item.state.message}</span>
              {looksLikePdf(item.file) && (
                <button
                  type="button"
                  onClick={() => {
                    update(item.id, { status: "queued" });
                    enqueue(item);
                  }}
                  className="rounded-md border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100"
                >
                  Try again
                </button>
              )}
            </div>
          )}
          {item.state.status === "review" && <ReviewForm terms={item.state.terms} today={today} onConfirm={(review) => confirm(item, review)} />}
          {item.state.status === "saved" && (
            <p className="text-sm text-ink">
              {item.state.message}{" "}
              <Link href="/" className="font-medium text-accent underline">
                Open the dashboard
              </Link>{" "}
              ·{" "}
              <Link href={`/vendors/${item.state.vendorId}`} className="font-medium text-accent underline">
                View contract
              </Link>
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function StatusBadge({ state }: { state: ItemState }) {
  const [text, tone] = {
    queued: ["Waiting", "bg-canvas text-ink"],
    extracting: ["Reading...", "bg-sky-100 text-sky-800"],
    error: ["Couldn't read", "bg-red-100 text-red-800"],
    review: ["Review", "bg-amber-100 text-amber-900"],
    saved: ["Added", "bg-emerald-100 text-emerald-800"],
  }[state.status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>;
}
