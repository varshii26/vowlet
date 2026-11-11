// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEADLINE_ICON, DEADLINE_LEGEND } from "@/components/Gantt/deadline-icons";
import { LEGEND_STATUSES, StatusLegend } from "@/components/Gantt/StatusLegend";
import { STATUS_LABEL } from "@/lib/timeline";

afterEach(cleanup);

describe("StatusLegend", () => {
  it("names every status a judge can see on the timeline, plus the wedding day", () => {
    render(<StatusLegend />);
    const legend = screen.getByRole("list", { name: "Timeline colours" });
    for (const status of LEGEND_STATUSES) expect(within(legend).getByText(STATUS_LABEL[status])).toBeTruthy();
    expect(within(legend).getByText("Wedding day")).toBeTruthy();
    expect(within(legend).getByText("Share paid")).toBeTruthy();
  });

  it("explains the contract-deadline icons with the same glyphs and colours the chart draws", () => {
    render(<StatusLegend />);
    const legend = screen.getByRole("list", { name: "Timeline colours" });
    for (const kind of ["date_change", "cancellation"] as const) {
      const item = within(legend).getByText(DEADLINE_LEGEND[kind].label).closest("li")!;
      // The very classes the chart's indicators use, and the shared colour token.
      expect(item.querySelector("i")!.className).toContain(DEADLINE_ICON[kind]);
      expect(item.querySelector<HTMLElement>("i")!.style.color).toBe(kind === "date_change" ? "var(--vw-deadline-date-change)" : "var(--vw-deadline-cancellation)");
      // The longer explanation is one hover away.
      expect(item.getAttribute("title")).toMatch(/last day/i);
      expect(item.getAttribute("title")).toMatch(/click it for the clause/i);
    }
    expect(DEADLINE_LEGEND.date_change.label).toBe("Change date by");
    expect(DEADLINE_LEGEND.cancellation.label).toBe("Cancel by");
  });

  it("shows what the dashed Today line is", () => {
    render(<StatusLegend />);
    const item = within(screen.getByRole("list", { name: "Timeline colours" })).getByText("Today").closest("li")!;
    expect(item.getAttribute("title")).toMatch(/dashed line/);
  });

  it("paints each swatch from Bryntum's own colour variable, so it matches the milestones", () => {
    const { container } = render(<StatusLegend />);
    const backgrounds = [...container.querySelectorAll<HTMLElement>("li > span[aria-hidden]")].map((el) => el.style.background);
    expect(backgrounds).toContain("color-mix(in srgb, var(--b-color-green) 60%, white)");
    expect(backgrounds).toContain("color-mix(in srgb, var(--b-color-amber) 60%, white)");
    expect(backgrounds).toContain("color-mix(in srgb, var(--b-color-pink) 60%, white)");
  });
});
