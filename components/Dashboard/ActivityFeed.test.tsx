// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityFeed } from "@/components/Dashboard/ActivityFeed";
import type { ActivityItem } from "@/lib/activity";

afterEach(cleanup);

const item = (over: Partial<ActivityItem>): ActivityItem => ({ id: "e1", type: "demo_seeded", message: "Loaded demo wedding", at: "2026-11-07T10:38:42.000Z", tone: "neutral", ...over });

describe("ActivityFeed", () => {
  it("lists entries in the order given, each with its time", () => {
    render(
      <ActivityFeed
        items={[item({ id: "a", type: "payment_paid", message: "Paid $500 to DJ Marlow Sound (DJ booking fee)", tone: "success" }), item({ id: "b", message: "Loaded demo wedding" })]}
      />,
    );
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Paid $500 to DJ Marlow Sound"), expect.stringContaining("Loaded demo wedding")]);
    expect(rows[0].querySelector("time")?.getAttribute("dateTime")).toBe("2026-11-07T10:38:42.000Z");
  });

  it("marks problems to check, also for screen readers", () => {
    render(<ActivityFeed items={[item({ type: "payment_amount_mismatch", message: "PayPal captured $5 but $500 was expected", tone: "warning" })]} />);
    const row = screen.getByRole("listitem");
    expect(row.getAttribute("data-tone")).toBe("warning");
    expect(row.textContent).toContain("Needs checking: PayPal captured $5");
  });

  it("says so when there is nothing yet", () => {
    render(<ActivityFeed items={[]} />);
    expect(screen.getByText("Nothing has happened yet.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows text as text, never as markup", () => {
    render(<ActivityFeed items={[item({ message: "<img src=x onerror=alert(1)> Vendor" })]} />);
    expect(screen.getByRole("listitem").querySelector("img")).toBeNull();
  });
});
