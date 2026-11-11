// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccuracyBadge, EVAL_README_URL, badgeText, formatPercent } from "@/components/ui/AccuracyBadge";

afterEach(cleanup);

const results = { accuracy: 63 / 65, correct: 63, total: 65, contracts: 14, quoteRate: 0.986, models: ["gemini-3.5-flash-lite"], date: "2026-11-11" };

describe("formatPercent", () => {
  it("shows one decimal, and none when whole", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(63 / 65)).toBe("96.9%");
    expect(formatPercent(0.5)).toBe("50%");
  });
});

describe("AccuracyBadge", () => {
  it("states the eval result and links to how it was measured", () => {
    render(<AccuracyBadge results={results} />);
    const link = screen.getByRole("link", { name: /Extraction accuracy 96.9% on 14 contracts · 98.6% of quotes verified/ });
    expect(link.getAttribute("href")).toBe(EVAL_README_URL);
    expect(link.getAttribute("title")).toContain("npm run eval on 2026-11-11 with gemini-3.5-flash-lite: 63/65 fields");
  });

  it("shows nothing without a valid results file", () => {
    const { container } = render(<AccuracyBadge results={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("reads the committed results by default", () => {
    render(<AccuracyBadge />);
    expect(screen.getByRole("link", { name: /^✓?\s*Extraction accuracy \d/ })).toBeTruthy();
    expect(badgeText(results).label).toBe("Extraction accuracy 96.9% on 14 contracts · 98.6% of quotes verified");
  });
});
