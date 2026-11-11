"use client";

import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { requestCapture, requestOrder, type CaptureOutcome } from "@/lib/payments/client";
import { SANDBOX_BUYER } from "@/lib/payments/sandbox";

/** A payment that went through (or is still processing). */
export type PaySettled = Extract<CaptureOutcome, { ok: true }>;

type Props = {
  paymentId: string;
  /** Called once the server has captured the payment (or PayPal says it is pending). */
  onSettled?: (outcome: PaySettled) => void;
};

type Notice = { tone: "error" | "info"; text: string };

const GENERIC_ERROR =
  "PayPal ran into a problem. Nothing was paid through Vowlet. If you're unsure, check your PayPal activity.";

/**
 * Loads the PayPal SDK once for every Pay button on the page. Wrap the app in
 * this, never a single button: each provider inserts its own SDK script while
 * the first is still loading, and each later copy destroys the buttons the
 * earlier one drew, leaving some rows without a Pay button.
 */
export function PayPalProvider({ children }: { children: ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  // Stable identity: the provider reloads the SDK whenever its options change.
  const options = useMemo(
    () => ({ clientId: clientId ?? "", currency: "USD", intent: "capture", components: "buttons" }),
    [clientId],
  );
  if (!clientId) return children;
  return <PayPalScriptProvider options={options}>{children}</PayPalScriptProvider>;
}

/**
 * Pay one vendor payment with PayPal. The PayPal popup is the human approval:
 * nothing is charged until the couple approves there, and nothing on this page
 * can approve for them. The server creates and captures the order; this only
 * relays the clicks. Needs a PayPalProvider above it.
 */
export function PayButton(props: Props) {
  if (!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) {
    return <p className="text-xs text-muted">PayPal isn&apos;t set up yet (missing NEXT_PUBLIC_PAYPAL_CLIENT_ID).</p>;
  }
  return <Buttons {...props} />;
}

function Buttons({ paymentId, onSettled }: Props) {
  const router = useRouter();
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function createOrder(): Promise<string> {
    setNotice(null);
    const result = await requestOrder(paymentId);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      throw new Error(result.message); // tells PayPal not to open the popup
    }
    return result.orderId;
  }

  async function onApprove(data: { orderID: string }): Promise<void> {
    setBusy(true);
    const result = await requestCapture(paymentId, data.orderID);
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    if (result.state === "pending") setNotice({ tone: "info", text: result.message });
    onSettled?.(result);
    router.refresh(); // the timeline and list re-render from the database
  }

  return (
    <div className="flex min-w-44 flex-col gap-1">
      {isPending && (
        <div role="status" className="skeleton h-8 w-full">
          <span className="sr-only">Loading PayPal...</span>
        </div>
      )}
      {isRejected && (
        <p role="alert" className="text-xs text-red-700">
          PayPal couldn&apos;t load. Check your connection and reload the page.
        </p>
      )}
      <PayPalButtons
        disabled={busy}
        style={{ layout: "horizontal", height: 32, tagline: false, label: "pay" }}
        createOrder={createOrder}
        onApprove={onApprove}
        onCancel={() => setNotice({ tone: "info", text: "Payment cancelled. Nothing was charged." })}
        onError={() => {
          setBusy(false);
          setNotice((current) => current ?? { tone: "error", text: GENERIC_ERROR });
        }}
      />
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error" ? "text-xs text-red-700" : "text-xs text-muted"}
        >
          {notice.text}
        </p>
      )}
      <SandboxLogin />
    </div>
  );
}

/**
 * The sandbox buyer to log in with in the PayPal popup. Without it nobody
 * trying the demo can get past PayPal's login. Narrow enough for the Next
 * payment card: two copy buttons, with the values a click away.
 */
export function SandboxLogin() {
  const [copied, setCopied] = useState<"email" | "password" | "failed" | null>(null);

  async function copy(which: "email" | "password") {
    try {
      await navigator.clipboard.writeText(SANDBOX_BUYER[which]);
      setCopied(which);
    } catch {
      setCopied("failed"); // the values stay visible below to select by hand
    }
  }

  const pill = "rounded-full border border-line bg-white px-2 py-0.5 font-medium text-ink hover:border-accent/40 hover:text-accent";
  return (
    <div className="space-y-1 text-[11px] leading-snug text-muted">
      <p>
        Demo: log in to PayPal as the <span className="font-medium text-ink">sandbox buyer</span> (test money only).
      </p>
      <p className="flex flex-wrap items-center gap-1">
        <button type="button" className={pill} onClick={() => void copy("email")}>
          {copied === "email" ? "Email copied" : "Copy email"}
        </button>
        <button type="button" className={pill} onClick={() => void copy("password")}>
          {copied === "password" ? "Password copied" : "Copy password"}
        </button>
      </p>
      <details open={copied === "failed" || undefined}>
        <summary className="cursor-pointer select-none hover:text-ink">Show login</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-1.5 font-mono">
          <dt>Email</dt>
          <dd className="break-all text-ink">{SANDBOX_BUYER.email}</dd>
          <dt>Password</dt>
          <dd className="break-all text-ink">{SANDBOX_BUYER.password}</dd>
        </dl>
      </details>
    </div>
  );
}
