"use client";

/** Opens the browser's print dialog (which also offers "Save as PDF"). Left out of the printed page itself. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-primary vw-no-print">
      {label}
    </button>
  );
}
