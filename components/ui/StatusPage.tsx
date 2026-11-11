import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame for "something isn't here" and "something went wrong" screens: the
 * Vowlet wordmark, a heading, a short explanation and the ways back. It lives
 * inside the root layout, so it gets the app's fonts and cream theme.
 */
export function StatusPage({ heading, children, actions }: { heading: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-5 px-6 py-24 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Vowlet</p>
      <h1 className="text-3xl text-ink">{heading}</h1>
      <div className="space-y-2 text-muted">{children}</div>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {actions}
        <Link href="/" className="btn btn-primary">
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
