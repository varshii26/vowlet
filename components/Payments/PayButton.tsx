"use client";

import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { requestCapture, requestOrder, type CaptureOutcome } from "@/lib/payments/client";

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
 * Pay one vendor payment with PayPal. The PayPal popup is the human approval:
 * nothing is charged until the couple approves there, and nothing on this page
 * can approve for them. The server creates and captures the order; this only
 * relays the clicks.
 */
export function PayButton(props: Props) {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  const options = useMemo(
    () => ({ clientId: clientId ?? "", currency: "USD", intent: "capture", components: "buttons" }),
    [clientId],
  );

  if (!clientId) {
    return <p className="text-xs text-neutral-500">PayPal isn&apos;t set up yet (missing NEXT_PUBLIC_PAYPAL_CLIENT_ID).</p>;
  }
  return (
    <PayPalScriptProvider options={options}>
      <Buttons {...props} />
    </PayPalScriptProvider>
  );
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
      {isPending && <p className="text-xs text-neutral-500">Loading PayPal...</p>}
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
          className={notice.tone === "error" ? "text-xs text-red-700" : "text-xs text-neutral-600"}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
