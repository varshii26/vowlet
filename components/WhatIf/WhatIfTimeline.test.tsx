// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatIfTimeline } from "@/components/WhatIf/WhatIfTimeline";
import type { TimelineData, TimelineInput } from "@/lib/timeline";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// The real chart needs Bryntum; this stand-in shows the dates it was handed and
// exposes the drop callback, which is all the what-if relies on.
const chart = vi.hoisted(() => ({ drop: (() => {}) as (iso: string) => void, data: null as unknown }));
vi.mock("@/components/Gantt/PaymentGantt", async () => {
  const { createElement } = await import("react");
  return {
    PaymentGantt: ({ data, onWeddingDateChange }: { data: TimelineData; onWeddingDateChange: (iso: string) => void }) => {
      chart.drop = onWeddingDateChange;
      chart.data = data;
      const days = data.tasks.flatMap((t) => [t, ...(t.children ?? [])]).map((t) => `${t.id}=${t.startDate ?? ""}`);
      return createElement("ul", { "aria-label": "chart" }, days.map((d) => createElement("li", { key: d }, d)));
    },
  };
});

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const input: TimelineInput = {
  wedding: { coupleNames: "Priya & Sam", date: d("2027-04-17") },
  vendors: [
    {
      id: "v1",
      name: "Grand Oak Estate",
      status: "active",
      signingDate: d("2026-06-12"),
      payments: [
        { id: "p1", label: "Deposit", amountCents: 300_000, anchor: "signing_date", offsetDays: 0, fixedDate: null, status: "paid", clause: null },
        { id: "p2", label: "Balance", amountCents: 300_000, anchor: "wedding_date", offsetDays: -30, fixedDate: null, status: "scheduled", clause: null },
      ],
    },
  ],
};

const previewBody = {
  ok: true,
  currentDate: "2027-04-17",
  newDate: "2027-06-12",
  shiftDays: 56,
  totalCents: 50_000,
  rows: [
    { vendorId: "v1", kind: "fee", vendorName: "Grand Oak Estate", costCents: 50_000, reason: "$500 (a $500 flat fee) with 161 days' notice.", clauseId: "c1", citation: "Grand Oak Estate contract, page 2", clause: { text: "Moving the event date costs a $500 flat fee.", page: 2 } },
    { vendorId: "v2", kind: "free", vendorName: "Bloom & Vine", costCents: 0, reason: "Free with 161 days' notice (needs at least 60).", clauseId: "c2", citation: null, clause: null },
    { vendorId: "v3", kind: "check", vendorName: "Lens & Light", costCents: 0, reason: "No date-change terms apply; check the contract.", clauseId: null, citation: null, clause: null },
  ],
};

const calls: { url: string; body: unknown }[] = [];
function stubFetch(responses: Record<string, { body: unknown; status?: number }>) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses[url] ?? { body: { ok: false, error: { code: "unavailable", message: "Not stubbed." } }, status: 503 };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
}

const chartDays = () => screen.getByRole("list", { name: "chart" }).textContent ?? "";
const drop = async (iso: string) => {
  await act(async () => {
    chart.drop(iso);
  });
};
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

beforeEach(() => {
  refresh.mockClear();
  calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WhatIfTimeline", () => {
  it("reflows wedding-anchored payments the moment the wedding day is dropped, before the server answers", async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (answer = resolve)));
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    expect(chartDays()).toContain("payment-p2=2027-03-18");

    await drop("2027-06-12");

    // Moved: the wedding and the balance (30 days before). Not moved: the signing-date deposit.
    expect(chartDays()).toContain("wedding=2027-06-12");
    expect(chartDays()).toContain("payment-p2=2027-05-13");
    expect(chartDays()).toContain("payment-p1=2026-06-12");
    expect(screen.getByText(/Working out each vendor/)).toBeTruthy();
    expect(screen.getByText(/56 days later than Apr 17, 2027/)).toBeTruthy();
    expect(screen.getByText(/1 payment tied to the wedding date moved/)).toBeTruthy();

    await act(async () => answer(new Response(JSON.stringify(previewBody))));
    expect(screen.getByText("$500", { selector: "span" })).toBeTruthy();
  });

  it("shows the server's per-vendor fees, flags contracts to check, and cites clauses", async () => {
    stubFetch({ "/api/whatif": { body: previewBody } });
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");

    expect(calls[0]).toEqual({ url: "/api/whatif", body: { newDate: "2027-06-12" } });
    const table = screen.getByRole("table");
    expect(table.textContent).toContain("Grand Oak Estate");
    expect(table.textContent).toContain("Grand Oak Estate contract, page 2");
    expect(table.textContent).not.toContain("Bloom & Vine");
    expect(screen.getByText(/Check these contracts/)).toBeTruthy();
    expect(screen.getByText("Lens & Light")).toBeTruthy();
    expect(screen.getByText(/1 vendor won't charge/)).toBeTruthy();
  });

  it("opens the quoted clause from a row's citation chip", async () => {
    stubFetch({ "/api/whatif": { body: previewBody } });
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");

    const chip = screen.getByRole("button", { name: "Grand Oak Estate contract, page 2" });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/Moving the event date costs/)).toBeNull();
    await click("Grand Oak Estate contract, page 2");
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const quote = screen.getByText(/Moving the event date costs a \$500 flat fee\./);
    expect(quote.closest("blockquote")?.id).toBe(chip.getAttribute("aria-controls"));
  });

  it("fills in the written summary after the table, and shows none if it fails", async () => {
    let explain: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", (url: string) =>
      url === "/api/whatif" ? Promise.resolve(new Response(JSON.stringify(previewBody))) : new Promise<Response>((resolve) => (explain = resolve)),
    );
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");

    // The table is up while the summary is still being written.
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText(/Writing a short summary/)).toBeTruthy();

    await act(async () => explain(new Response(JSON.stringify({ ok: true, newDate: "2027-06-12", text: "Moving costs $500, all Grand Oak Estate.", source: "model" }))));
    expect(screen.getByTestId("whatif-explanation").textContent).toBe("Moving costs $500, all Grand Oak Estate.");
    expect(screen.queryByText(/Writing a short summary/)).toBeNull();
  });

  it("shows no summary when it can't be written, and the table still works", async () => {
    stubFetch({ "/api/whatif": { body: previewBody } });
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");
    expect(calls.map((c) => c.url)).toEqual(["/api/whatif", "/api/whatif/explain"]);
    expect(screen.queryByTestId("whatif-explanation")).toBeNull();
    expect(screen.queryByText(/Writing a short summary/)).toBeNull();
    expect((screen.getByRole("button", { name: /Move the wedding/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("cancel snaps everything back and saves nothing", async () => {
    stubFetch({ "/api/whatif": { body: previewBody } });
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");
    await click("Cancel");

    expect(chartDays()).toContain("wedding=2027-04-17");
    expect(chartDays()).toContain("payment-p2=2027-03-18");
    expect(screen.queryByRole("region", { name: /What if/ })).toBeNull();
    expect(calls.map((c) => c.url)).not.toContain("/api/whatif/apply");
  });

  it("dragging back to the current date is the same as cancelling", async () => {
    stubFetch({ "/api/whatif": { body: previewBody } });
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");
    await drop("2027-04-17");
    expect(screen.queryByRole("region", { name: /What if/ })).toBeNull();
    expect(chartDays()).toContain("wedding=2027-04-17");
  });

  it("confirming applies the move against the date the couple saw, then refreshes the page", async () => {
    stubFetch({
      "/api/whatif": { body: previewBody },
      "/api/whatif/apply": { body: { ok: true, message: "Approved. The wedding is now on 2027-06-12." } },
    });
    const { rerender } = render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");
    await click(/Move the wedding to Jun 12, 2027/);

    expect(calls.find((c) => c.url === "/api/whatif/apply")).toEqual({ url: "/api/whatif/apply", body: { newDate: "2027-06-12", previousDate: "2027-04-17" } });
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("now on 2027-06-12");
    // Until the refreshed page arrives, the chart keeps showing the new date.
    expect(chartDays()).toContain("wedding=2027-06-12");

    // The refreshed page has the new date: the panel closes and the chart stays put.
    rerender(<WhatIfTimeline input={{ ...input, wedding: { ...input.wedding, date: d("2027-06-12") } }} todayIso="2026-11-07" />);
    expect(screen.queryByRole("region", { name: /What if/ })).toBeNull();
    expect(chartDays()).toContain("wedding=2027-06-12");
  });

  it("keeps the preview and says why when applying fails", async () => {
    stubFetch({
      "/api/whatif": { body: previewBody },
      "/api/whatif/apply": { body: { ok: false, error: { code: "stale", message: "The wedding date has changed since you started." } }, status: 409 },
    });
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");
    await click(/Move the wedding/);

    expect(screen.getByRole("alert").textContent).toContain("changed since you started");
    expect(refresh).not.toHaveBeenCalled();
    expect(chartDays()).toContain("wedding=2027-06-12");
  });

  it("can't confirm until the fees are known, and shows a what-if error", async () => {
    stubFetch({ "/api/whatif": { body: { ok: false, error: { code: "in_past", message: "2026-01-01 has already passed." } }, status: 400 } });
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2026-12-01");
    expect(screen.getByRole("alert").textContent).toContain("already passed");
    expect((screen.getByRole("button", { name: /Move the wedding/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores the answer to an earlier drop", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => resolvers.push(resolve)));
    render(<WhatIfTimeline input={input} todayIso="2026-11-07" />);
    await drop("2027-06-12");
    await drop("2027-07-01");

    await act(async () => resolvers[1](new Response(JSON.stringify({ ...previewBody, newDate: "2027-07-01", totalCents: 70_000 }))));
    await act(async () => resolvers[0](new Response(JSON.stringify(previewBody))));
    expect(screen.getByText("$700")).toBeTruthy();
    expect(screen.queryByText("$500", { selector: "span.text-2xl" })).toBeNull();
  });
});
