// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VendorList, type VendorCardData } from "@/components/Vendors/VendorList";

afterEach(cleanup);

const vendor = (over: Partial<VendorCardData> = {}): VendorCardData => ({
  id: "v1",
  name: "Grand Oak Estate",
  category: "venue",
  totalLabel: "$9,000",
  summary: "3 payments, $3,000 of $9,000 paid.",
  cancelled: false,
  ...over,
});

describe("VendorList", () => {
  it("links every vendor to its contract page with its category, total and progress", () => {
    render(<VendorList vendors={[vendor(), vendor({ id: "v2", name: "DJ Marlow Sound", category: "dj", totalLabel: "$1,500" })]} />);
    const link = screen.getByRole("link", { name: /Grand Oak Estate/ });
    expect(link.getAttribute("href")).toBe("/vendors/v1");
    expect(link.textContent).toContain("venue");
    expect(link.textContent).toContain("$9,000");
    expect(link.textContent).toContain("3 payments, $3,000 of $9,000 paid.");
    expect(screen.getByRole("link", { name: /DJ Marlow Sound/ }).getAttribute("href")).toBe("/vendors/v2");
  });

  it("marks a cancelled vendor", () => {
    render(<VendorList vendors={[vendor({ cancelled: true })]} />);
    const link = screen.getByRole("link", { name: /Grand Oak Estate/ });
    expect(within(link).getByText("Cancelled")).toBeTruthy();
    expect(within(link).getByText("Grand Oak Estate").className).toContain("line-through");
  });

  it("says so when there are no vendors", () => {
    render(<VendorList vendors={[]} />);
    expect(screen.getByText(/No vendors yet/)).toBeTruthy();
  });
});
