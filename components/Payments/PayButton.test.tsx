// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayButton } from "@/components/Payments/PayButton";

// The PayPal SDK loads a script from PayPal, so it is the one thing we fake. The
// fake renders a button and hands us the callbacks the real one would call.
type ButtonProps = {
  disabled?: boolean;
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel: () => void;
  onError: (error: unknown) => void;
};
const sdk = vi.hoisted(() => ({
  props: undefined as unknown,
  script: { isPending: false, isRejected: false },
  providerOptions: undefined as unknown,
}));
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@paypal/react-paypal-js", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    PayPalScriptProvider: ({ children, options }: { children: React.ReactNode; options: unknown }) => {
      sdk.providerOptions = options;
      return createElement(Fragment, null, children);
    },
    usePayPalScriptReducer: () => [{ ...sdk.script }, vi.fn()],
    PayPalButtons: (props: ButtonProps) => {
      sdk.props = props;
      return createElement("button", { disabled: props.disabled }, "PayPal button");
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const buttons = () => sdk.props as ButtonProps;
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_PAYPAL_CLIENT_ID", "test-client-id");
  sdk.script.isPending = false;
  sdk.script.isRejected = false;
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PayButton", () => {
  it("shows the PayPal button, loading the SDK for sandbox USD checkout", () => {
    render(<PayButton paymentId="p1" />);
    expect(screen.getByRole("button", { name: "PayPal button" })).toBeTruthy();
    expect(sdk.providerOptions).toMatchObject({ clientId: "test-client-id", currency: "USD", intent: "capture", components: "buttons" });
  });

  it("explains when PayPal is not configured, instead of showing a broken button", () => {
    vi.stubEnv("NEXT_PUBLIC_PAYPAL_CLIENT_ID", "");
    render(<PayButton paymentId="p1" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/PayPal isn.t set up yet/)).toBeTruthy();
  });

  it("says PayPal is loading, and says so if it fails to load", () => {
    sdk.script.isPending = true;
    const { rerender } = render(<PayButton paymentId="p1" />);
    expect(screen.getByText("Loading PayPal...")).toBeTruthy();

    sdk.script.isPending = false;
    sdk.script.isRejected = true;
    rerender(<PayButton paymentId="p1" />);
    expect(screen.getByRole("alert").textContent).toContain("couldn't load");
  });

  describe("creating the order", () => {
    it("asks our server for an order and hands PayPal the id", async () => {
      const fetchMock = reply({ ok: true, orderId: "ORDER-1" });
      vi.stubGlobal("fetch", fetchMock);
      render(<PayButton paymentId="p1" />);

      let id = "";
      await act(async () => {
        id = await buttons().createOrder();
      });
      expect(id).toBe("ORDER-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/payments/p1/order", expect.objectContaining({ method: "POST" }));
    });

    it("shows the server's reason and stops PayPal opening the popup when it refuses", async () => {
      vi.stubGlobal("fetch", reply({ ok: false, error: { code: "not_payable", message: "This payment has already been settled." } }, 409));
      render(<PayButton paymentId="p1" />);

      await act(async () => {
        await expect(buttons().createOrder()).rejects.toThrow("already been settled");
      });
      expect(screen.getByRole("alert").textContent).toBe("This payment has already been settled.");
    });

    it("clears an old message when the couple tries again", async () => {
      render(<PayButton paymentId="p1" />);
      act(() => buttons().onCancel());
      expect(screen.getByRole("status")).toBeTruthy();

      vi.stubGlobal("fetch", reply({ ok: true, orderId: "ORDER-2" }));
      await act(async () => {
        await buttons().createOrder();
      });
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  describe("after approval", () => {
    it("captures the order, reports it, and refreshes the page data", async () => {
      const fetchMock = reply({ ok: true, state: "paid", message: "Payment complete." });
      vi.stubGlobal("fetch", fetchMock);
      const onSettled = vi.fn();
      render(<PayButton paymentId="p1" onSettled={onSettled} />);

      await act(async () => {
        await buttons().onApprove({ orderID: "ORDER-1" });
      });

      const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(path).toBe("/api/payments/p1/capture");
      expect(JSON.parse(String(init.body))).toEqual({ orderId: "ORDER-1" });
      expect(onSettled).toHaveBeenCalledWith({ ok: true, state: "paid", message: "Payment complete." });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows the reason, leaves the page as it was, and does not report success, when capture fails", async () => {
      vi.stubGlobal("fetch", reply({ ok: false, error: { code: "declined", message: "PayPal declined that payment method." } }, 402));
      const onSettled = vi.fn();
      render(<PayButton paymentId="p1" onSettled={onSettled} />);

      await act(async () => {
        await buttons().onApprove({ orderID: "ORDER-1" });
      });

      expect(screen.getByRole("alert").textContent).toBe("PayPal declined that payment method.");
      expect(onSettled).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("tells the couple a pending payment is still processing", async () => {
      vi.stubGlobal("fetch", reply({ ok: true, state: "pending", message: "PayPal is still processing this payment." }, 202));
      const onSettled = vi.fn();
      render(<PayButton paymentId="p1" onSettled={onSettled} />);

      await act(async () => {
        await buttons().onApprove({ orderID: "ORDER-1" });
      });

      expect(screen.getByRole("status").textContent).toBe("PayPal is still processing this payment.");
      expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ state: "pending" }));
    });

    it("disables the button while the capture is in flight, so it cannot be clicked twice", async () => {
      let finish: (r: Response) => void = () => {};
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))));
      render(<PayButton paymentId="p1" />);
      expect(buttons().disabled).toBe(false);

      let done: Promise<void> = Promise.resolve();
      act(() => {
        done = buttons().onApprove({ orderID: "ORDER-1" });
      });
      expect(buttons().disabled).toBe(true);
      expect(screen.getByRole("button", { name: "PayPal button" }).hasAttribute("disabled")).toBe(true);

      await act(async () => {
        finish(new Response(JSON.stringify({ ok: true, state: "paid", message: "Payment complete." })));
        await done;
      });
      expect(buttons().disabled).toBe(false);
    });
  });

  describe("when the popup is closed or PayPal errors", () => {
    it("says nothing was charged after a cancel, and calls our server for nothing", () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const onSettled = vi.fn();
      render(<PayButton paymentId="p1" onSettled={onSettled} />);

      act(() => buttons().onCancel());

      expect(screen.getByRole("status").textContent).toBe("Payment cancelled. Nothing was charged.");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onSettled).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("shows a plain message when PayPal reports an error", () => {
      render(<PayButton paymentId="p1" />);
      act(() => buttons().onError(new Error("anything")));
      expect(screen.getByRole("alert").textContent).toContain("Nothing was paid through Vowlet");
    });

    it("does not overwrite our own, more specific message with the generic one", async () => {
      vi.stubGlobal("fetch", reply({ ok: false, error: { code: "not_payable", message: "This payment has already been settled." } }, 409));
      render(<PayButton paymentId="p1" />);
      await act(async () => {
        await buttons().createOrder().catch(() => {});
      });
      act(() => buttons().onError(new Error("createOrder failed")));
      expect(screen.getByRole("alert").textContent).toBe("This payment has already been settled.");
    });
  });
});
