"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type ToastTone = "success" | "info" | "error";

type Toast = { id: number; tone: ToastTone; text: string };

type ToastApi = {
  /** Show a short message in the corner. It goes away by itself after a few seconds. */
  toast: (text: string, tone?: ToastTone) => void;
  /** A small burst of confetti, for a payment that went through. */
  celebrate: () => void;
};

// Without a provider (unit tests, a page that doesn't need it) both do nothing.
const ToastContext = createContext<ToastApi>({ toast: () => {}, celebrate: () => {} });

export const useToast = () => useContext(ToastContext);

const TOAST_MS = 4500;
const CONFETTI_MS = 1600;
const CONFETTI_COLORS = ["#a8435a", "#e8a0b0", "#c08a3e", "#f3d9a4", "#7c9a7e", "#ffffff"];

const TONE: Record<ToastTone, { box: string; dot: string }> = {
  success: { box: "border-emerald-200", dot: "bg-emerald-500" },
  info: { box: "border-line", dot: "bg-accent" },
  error: { box: "border-red-200", dot: "bg-red-500" },
};

type Piece = { id: number; style: CSSProperties };

function confettiPieces(seed: number): Piece[] {
  return Array.from({ length: 36 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 36 + Math.random() * 0.4;
    const distance = 140 + Math.random() * 180;
    return {
      id: seed * 100 + i,
      style: {
        left: "50%",
        top: "40%",
        width: i % 3 === 0 ? 10 : 7,
        height: i % 3 === 0 ? 6 : 10,
        background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        borderRadius: i % 4 === 0 ? 9999 : 2,
        animation: `vw-confetti ${CONFETTI_MS}ms cubic-bezier(.15,.6,.35,1) forwards`,
        ["--dx" as string]: `${Math.cos(angle) * distance}px`,
        ["--dy" as string]: `${Math.sin(angle) * distance + 120}px`,
        ["--rot" as string]: `${Math.round(Math.random() * 720 - 360)}deg`,
      },
    };
  });
}

/**
 * Toasts for quick confirmations (approved, dismissed, paid) and a confetti
 * burst for a completed payment. Toasts are announced politely to screen
 * readers; the confetti is decorative and skipped for reduced motion.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (text: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { id, tone, text }]);
      timers.current.push(window.setTimeout(() => dismiss(id), TOAST_MS));
    },
    [dismiss],
  );

  const celebrate = useCallback(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const seed = nextId.current++;
    setPieces(confettiPieces(seed));
    timers.current.push(window.setTimeout(() => setPieces([]), CONFETTI_MS + 100));
  }, []);

  const api = useMemo(() => ({ toast, celebrate }), [toast, celebrate]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-5 z-[60] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`animate-fade-up pointer-events-auto flex items-start gap-3 rounded-card border bg-surface px-4 py-3 text-sm text-ink shadow-float ${TONE[t.tone].box}`}
          >
            <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE[t.tone].dot}`} />
            <span className="min-w-0 flex-1">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded text-muted hover:text-ink">
              ✕
            </button>
          </div>
        ))}
      </div>
      {pieces.length > 0 && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
          {pieces.map((p) => (
            <span key={p.id} className="absolute block" style={p.style} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
