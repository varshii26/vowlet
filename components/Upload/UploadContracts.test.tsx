// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadContracts } from "@/components/Upload/UploadContracts";

const ev = (over: Record<string, unknown> = {}) => ({
  clauseQuote: "The Client shall pay $3,000 (Venue deposit) upon signing this agreement.",
  page: 1,
  confidence: 0.95,
  quoteVerified: true,
  needsReview: false,
  ...over,
});

const extracted = {
  ok: true,
  terms: {
    vendorName: "Grand Oak Estate",
    category: "venue",
    totalCents: 900_000,
    payments: [
      { label: "Venue deposit", amountCents: 300_000, anchor: "signing_date", offsetDays: 0, fixedDate: null, ...ev() },
      { label: "Venue final balance", amountCents: 600_000, anchor: "wedding_date", offsetDays: -30, fixedDate: null, ...ev({ clauseQuote: "Balance due 30 days before.", confidence: 0.55, needsReview: true }) },
    ],
    cancellation: { found: true, rules: [{ minNoticeDays: 90, refundPercent: 50, flatFee: 0 }], ...ev({ clauseQuote: "Made-up clause", confidence: 0, quoteVerified: false, needsReview: true }) },
    dateChange: { found: false, rules: [], ...ev({ clauseQuote: "", needsReview: false, quoteVerified: false }) },
  },
};

type Call = { url: string; form: FormData };
const calls: Call[] = [];

/** Each URL answers from its own list of responses, in order. A function response waits until the test resolves it. */
function stubFetch(responses: Record<string, (() => Promise<Response>)[]>) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, form: init?.body as FormData });
    const next = responses[url]?.shift();
    return next ? next() : new Response(JSON.stringify({ ok: false, error: { message: "Not stubbed." } }), { status: 503 });
  });
}
const json = (body: unknown, status = 200) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

const pdf = (name: string) => new File(["%PDF-1.4 test"], name, { type: "application/pdf" });

async function pick(...files: File[]) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Contract PDFs"), { target: { files } });
  });
}
const flush = () => act(async () => {});
const confirmButton = () => screen.getByRole("button", { name: /Confirm and add to timeline/ }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("UploadContracts", () => {
  it("shows a loading state while the contract is read, then the terms with their clause quotes", async () => {
    let answer: (r: Response) => void = () => {};
    stubFetch({ "/api/contracts/extract": [() => new Promise<Response>((resolve) => (answer = resolve))] });
    render(<UploadContracts />);
    await pick(pdf("grand-oak.pdf"));

    expect(screen.getByText(/Reading the contract/)).toBeTruthy();
    expect(calls[0].url).toBe("/api/contracts/extract");
    expect((calls[0].form.get("file") as File).name).toBe("grand-oak.pdf");

    await act(async () => answer(new Response(JSON.stringify(extracted))));
    expect(screen.queryByText(/Reading the contract/)).toBeNull();
    expect((screen.getByDisplayValue("Grand Oak Estate") as HTMLInputElement).value).toBe("Grand Oak Estate");
    expect(screen.getByDisplayValue("6000")).toBeTruthy();
    expect(screen.getByText(/upon signing this agreement/).textContent).toContain("(page 1)");
    expect(screen.getByText("Not in this contract.")).toBeTruthy();
  });

  it("shows the server's error, and one failing file doesn't block the next", async () => {
    stubFetch({
      "/api/contracts/extract": [
        json({ ok: false, error: { code: "no_text", message: "That PDF has no selectable text." } }, 422),
        json(extracted),
      ],
    });
    render(<UploadContracts />);
    await pick(pdf("scan.pdf"), pdf("grand-oak.pdf"));
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("That PDF has no selectable text.");
    expect(screen.getByDisplayValue("Grand Oak Estate")).toBeTruthy();
    expect(calls.map((c) => (c.form.get("file") as File).name)).toEqual(["scan.pdf", "grand-oak.pdf"]);
  });

  it("reads files one at a time", async () => {
    const answers: ((r: Response) => void)[] = [];
    const pending = () => new Promise<Response>((resolve) => answers.push(resolve));
    stubFetch({ "/api/contracts/extract": [pending, pending] });
    render(<UploadContracts />);
    await pick(pdf("a.pdf"), pdf("b.pdf"));

    expect(calls).toHaveLength(1);
    expect(screen.getByText(/Waiting for the previous contract/)).toBeTruthy();
    await act(async () => answers[0](new Response(JSON.stringify(extracted))));
    expect(calls).toHaveLength(2);
  });

  it("rejects a file that isn't a PDF without sending it", async () => {
    stubFetch({});
    render(<UploadContracts />);
    await pick(new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(screen.getByRole("alert").textContent).toContain("isn't a PDF");
    expect(calls).toHaveLength(0);
  });

  it("keeps Confirm disabled until every flagged term is ticked or edited", async () => {
    stubFetch({ "/api/contracts/extract": [json(extracted)] });
    render(<UploadContracts />);
    await pick(pdf("grand-oak.pdf"));
    await flush();

    expect(screen.getAllByText("Please confirm")).toHaveLength(2);
    expect(screen.getByText(/only 55% sure/)).toBeTruthy();
    expect(screen.getByText(/wasn't found in the PDF/)).toBeTruthy();
    expect(screen.getByTestId("pending-confirmations").textContent).toContain("Venue final balance, Cancellation terms");
    expect(confirmButton().disabled).toBe(true);

    // Editing a flagged payment counts as checking it.
    fireEvent.change(screen.getByLabelText("Venue final balance amount"), { target: { value: "6000.00" } });
    expect(confirmButton().disabled).toBe(true);
    // Ticking the box confirms the other.
    fireEvent.click(screen.getByLabelText("I've checked cancellation"));
    expect(confirmButton().disabled).toBe(false);
    expect(screen.queryByTestId("pending-confirmations")).toBeNull();

    // Unticking takes it back.
    fireEvent.click(screen.getByLabelText("I've checked cancellation"));
    expect(confirmButton().disabled).toBe(true);
  });

  it("sends the PDF and the reviewed terms in cents, then links to the dashboard", async () => {
    stubFetch({
      "/api/contracts/extract": [json(extracted)],
      "/api/contracts/confirm": [json({ ok: true, vendorId: "v42", vendorName: "Grand Oak Estate", message: "Grand Oak Estate is on your timeline." })],
    });
    render(<UploadContracts />);
    await pick(pdf("grand-oak.pdf"));
    await flush();

    fireEvent.click(screen.getByLabelText("I've checked Venue final balance"));
    fireEvent.click(screen.getByLabelText("I've checked cancellation"));
    fireEvent.change(screen.getByLabelText("Venue deposit amount"), { target: { value: "25%" } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });

    const sent = calls[1];
    expect(sent.url).toBe("/api/contracts/confirm");
    expect((sent.form.get("file") as File).name).toBe("grand-oak.pdf");
    const review = JSON.parse(String(sent.form.get("review")));
    expect(review.payments.map((p: { amountCents: number }) => p.amountCents)).toEqual([225_000, 600_000]);
    expect(review.payments[1]).toMatchObject({ flagged: true, acknowledged: true });
    expect(review.cancellation).toMatchObject({ flagged: true, acknowledged: true });

    expect(screen.getByText(/Grand Oak Estate is on your timeline./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View contract" }).getAttribute("href")).toBe("/vendors/v42");
    expect(screen.getByRole("link", { name: "See them on the timeline" }).getAttribute("href")).toBe("/");
  });

  it("keeps the form and shows the reason when saving fails", async () => {
    stubFetch({
      "/api/contracts/extract": [json(extracted)],
      "/api/contracts/confirm": [json({ ok: false, error: { code: "needs_confirmation", message: "Please confirm these before saving: cancellation terms." } }, 422)],
    });
    render(<UploadContracts />);
    await pick(pdf("grand-oak.pdf"));
    await flush();
    fireEvent.click(screen.getByLabelText("I've checked Venue final balance"));
    fireEvent.click(screen.getByLabelText("I've checked cancellation"));
    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(screen.getByRole("alert").textContent).toContain("Please confirm these before saving");
    expect(confirmButton().disabled).toBe(false);
  });

  it("explains invalid edits instead of sending them", async () => {
    stubFetch({ "/api/contracts/extract": [json(extracted)] });
    render(<UploadContracts />);
    await pick(pdf("grand-oak.pdf"));
    await flush();
    fireEvent.click(screen.getByLabelText("I've checked Venue final balance"));
    fireEvent.click(screen.getByLabelText("I've checked cancellation"));
    fireEvent.change(screen.getByLabelText("Venue deposit amount"), { target: { value: "three grand" } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(screen.getByRole("alert").textContent).toContain("Venue deposit: enter an amount like 1500 or 25%.");
    expect(calls).toHaveLength(1);
  });

  describe("Try a sample contract", () => {
    const samplePdf = () => () => Promise.resolve(new Response(new Blob(["%PDF-1.4 sample"], { type: "application/pdf" })));

    it("offers the ambiguous and the addendum contracts", () => {
      render(<UploadContracts />);
      expect(screen.getByRole("button", { name: /Try Dapper & Co Tailoring/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Try DJ Marlow Sound/ })).toBeTruthy();
    });

    it("runs the real extraction on the seeded PDF, review-only, so the demo gets no duplicate vendor", async () => {
      stubFetch({ "/api/contracts/samples/dapper-and-co-tailoring": [samplePdf()], "/api/contracts/extract": [json(extracted)] });
      render(<UploadContracts />);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Try Dapper & Co Tailoring/ })));
      await waitFor(() => expect(screen.queryByTestId("review-only")).not.toBeNull());

      expect(calls.map((c) => c.url)).toEqual(["/api/contracts/samples/dapper-and-co-tailoring", "/api/contracts/extract"]);
      expect((calls[1].form.get("file") as File).name).toBe("dapper-and-co-tailoring.pdf");
      // The review shows, with its Please confirm flags, but there is nothing to save.
      expect(screen.getAllByText("Please confirm").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /Confirm and add to timeline/ })).toBeNull();
      expect(screen.getByTestId("review-only").textContent).toContain("already one of Priya & Sam's vendors");
      expect(calls.some((c) => c.url === "/api/contracts/confirm")).toBe(false);
    });

    it("says so when the sample can't be loaded", async () => {
      stubFetch({});
      render(<UploadContracts />);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Try DJ Marlow Sound/ })));
      await flush();
      expect(screen.getByRole("alert").textContent).toContain("Couldn't load the sample contract");
      expect(calls.some((c) => c.url === "/api/contracts/extract")).toBe(false);
    });

    it("still lets an uploaded PDF be saved", async () => {
      stubFetch({ "/api/contracts/extract": [json(extracted)] });
      render(<UploadContracts />);
      await pick(pdf("grand-oak.pdf"));
      await flush();
      expect(confirmButton()).toBeTruthy();
      expect(screen.queryByTestId("review-only")).toBeNull();
    });
  });
});
