// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LEGEND_STATUSES, StatusLegend } from "@/components/Gantt/StatusLegend";
import { STATUS_LABEL } from "@/lib/timeline";

describe("StatusLegend", () => {
  it("names every status a judge can see on the timeline, plus the wedding day", () => {
    render(<StatusLegend />);
    const legend = screen.getByRole("list", { name: "Timeline colours" });
    for (const status of LEGEND_STATUSES) expect(within(legend).getByText(STATUS_LABEL[status])).toBeTruthy();
    expect(within(legend).getByText("Wedding day")).toBeTruthy();
    expect(within(legend).getByText("Vendor bar: share paid")).toBeTruthy();
  });

  it("paints each swatch from Bryntum's own colour variable, so it matches the milestones", () => {
    const { container } = render(<StatusLegend />);
    const backgrounds = [...container.querySelectorAll<HTMLElement>("li > span[aria-hidden]")].map((el) => el.style.background);
    expect(backgrounds).toContain("color-mix(in srgb, var(--b-color-green) 60%, white)");
    expect(backgrounds).toContain("color-mix(in srgb, var(--b-color-amber) 60%, white)");
    expect(backgrounds).toContain("color-mix(in srgb, var(--b-color-pink) 60%, white)");
  });
});
