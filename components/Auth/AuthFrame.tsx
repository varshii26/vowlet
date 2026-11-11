import type { ReactNode } from "react";

/**
 * The frame for the sign-in and sign-up pages: the Vowlet wordmark, one line on
 * what it does, then the card. Same cream canvas and type as the app.
 */
export function AuthFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-12">
      <header className="space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Vowlet</p>
        <h1 className="text-3xl text-ink">{title}</h1>
        <p className="text-muted">Your wedding payments, read from your contracts.</p>
      </header>
      <div className="space-y-5 rounded-card border border-line bg-surface p-6 shadow-card">{children}</div>
      {footer && <p className="text-center text-sm text-muted">{footer}</p>}
    </main>
  );
}

/** A labelled rule between sections of the card: "or". */
export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
