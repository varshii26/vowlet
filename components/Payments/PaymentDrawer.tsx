"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PayButton, type PaySettled } from "@/components/Payments/PayButton";
import { StatusBadge } from "@/components/Payments/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import type { DisplayStatus } from "@/lib/schedule";
import { paymentTaskId, vendorTaskId, type TaskDetail } from "@/lib/timeline";
import { clauseHref } from "@/lib/vendors/links";

export type PaymentDetail = Extract<TaskDetail, { kind: "payment" }>;

type DrawerApi = {
  /** Open the drawer on a payment: its details, or just its id (looked up in the current timeline). */
  openPayment: (payment: PaymentDetail | string) => void;
};

const DrawerContext = createContext<DrawerApi | null>(null);

/** Null outside a PaymentDrawerProvider, so a list can fall back to plain rows. */
export const usePaymentDrawer = () => useContext(DrawerContext);

/** Statuses the couple can still pay. */
const PAYABLE: ReadonlySet<DisplayStatus> = new Set(["scheduled", "due_soon", "overdue"]);

type Props = {
  /** The saved timeline's task details, so the drawer shows the latest status after a refresh. */
  details: Record<string, TaskDetail>;
  children: ReactNode;
};

/**
 * The payment side drawer: amount, due date, status, the contract clause the
 * payment comes from, and the Pay button. Opened by clicking a payment on the
 * Gantt or in a list. It is a modal dialog: Escape or the backdrop closes it and
 * focus goes back to where it was.
 */
export function PaymentDrawerProvider({ details, children }: Props) {
  const [selected, setSelected] = useState<PaymentDetail | null>(null);
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  const openPayment = useCallback(
    (payment: PaymentDetail | string) => {
      const detail = typeof payment === "string" ? details[paymentTaskId(payment)] : payment;
      if (!detail || detail.kind !== "payment") return;
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSelected(detail);
      setOpen(true);
    },
    [details],
  );

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus?.();
  }, []);

  // Always show the saved payment: after a payment the page refreshes with the new
  // status, and a click during a what-if preview must not show the unsaved date.
  const saved = selected ? details[paymentTaskId(selected.paymentId)] : undefined;
  const current = saved?.kind === "payment" ? saved : selected;
  const vendor = current ? details[vendorTaskId(current.vendorId)] : undefined;
  const vendorCancelled = vendor?.kind === "vendor" && vendor.cancelled;

  const api = useMemo(() => ({ openPayment }), [openPayment]);

  return (
    <DrawerContext.Provider value={api}>
      {children}
      <Drawer open={open} payment={current} vendorCancelled={vendorCancelled} onClose={close} />
    </DrawerContext.Provider>
  );
}

function Drawer({ open, payment, vendorCancelled, onClose }: { open: boolean; payment: PaymentDetail | null; vendorCancelled: boolean; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const { toast, celebrate } = useToast();

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab" || !panel.current) return;
      // Keep Tab inside the drawer while it is open.
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = panel.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function settled(outcome: PaySettled) {
    if (!payment) return;
    if (outcome.state === "pending") {
      toast(`${payment.vendorName}, ${payment.title}: ${outcome.message}`, "info");
      return;
    }
    celebrate();
    toast(`Paid ${payment.amountLabel} to ${payment.vendorName} (${payment.title}).`);
  }

  const payable = payment !== null && PAYABLE.has(payment.status) && !vendorCancelled;

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} inert={!open} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-ink/25 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} />
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-drawer-title"
        className={`absolute inset-y-0 right-0 flex w-[26rem] max-w-full flex-col border-l border-line bg-surface shadow-float transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {payment && (
          <>
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-muted">{payment.vendorName}</p>
                <h2 id="payment-drawer-title" className="text-2xl text-ink">
                  {payment.title}
                </h2>
              </div>
              <button ref={closeButton} type="button" onClick={onClose} aria-label="Close payment details" className="btn btn-secondary size-9 shrink-0 p-0">
                ✕
              </button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              <dl className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Amount</dt>
                  <dd className="mt-1 font-serif text-4xl tabular-nums text-ink">{payment.amountLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Due</dt>
                  <dd className="mt-1 text-sm font-medium">{payment.dateLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">Status</dt>
                  <dd className="mt-1">
                    <StatusBadge status={payment.status} label={payment.statusLabel} />
                  </dd>
                </div>
              </dl>

              <div className="space-y-2">
                <h3 className="text-xs font-sans font-medium uppercase tracking-wide text-muted">From the contract</h3>
                {payment.clauseId ? (
                  <figure className="rounded-card border-l-4 border-accent bg-accent-soft/60 p-4">
                    <blockquote className="whitespace-pre-line text-sm leading-relaxed text-ink">&ldquo;{payment.clauseText ?? payment.clauseSummary}&rdquo;</blockquote>
                    <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="rounded-full bg-surface px-2 py-0.5 font-medium text-ink">
                        {payment.vendorName} contract{payment.clausePage ? `, page ${payment.clausePage}` : ""}
                      </span>
                      <a href={clauseHref(payment.vendorId, payment.clauseId)} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
                        Open in contract
                      </a>
                    </figcaption>
                  </figure>
                ) : (
                  <p className="text-sm text-muted">No contract clause is linked to this payment.</p>
                )}
              </div>
            </div>

            <footer className="space-y-2 border-t border-line bg-canvas px-6 py-5">
              {payable ? (
                <>
                  <PayButton key={payment.paymentId} paymentId={payment.paymentId} onSettled={settled} />
                  <p className="text-xs text-muted">You approve the payment in PayPal. Vowlet never pays on its own.</p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  {vendorCancelled ? "This vendor is cancelled, so there is nothing to pay." : `Nothing to pay: this payment is ${payment.statusLabel.toLowerCase()}.`}
                </p>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
