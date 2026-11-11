// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEADLINE_ICON, DEADLINE_LEGEND } from "@/components/Gantt/deadline-icons";
import { LEGEND_STATUSES, StatusLegend } from "@/components/Gantt/StatusLegend";
import { STATUS_HEX, STATUS_LABEL } from "@/lib/timeline";

afterEach(cleanup);

const legend = () => screen.getByRole("list", { name: "Timeline colours" });

describe("StatusLegend", () => {
  it("names the four everyday statuses, the wedding line and the Today line, and nothing else by default", () => {
    render(<StatusLegend />);
    for (const status of LEGEND_STATUSES) expect(within(legend()).getByText(STATUS_LABEL[status])).toBeTruthy();
    expect(LEGEND_STATUSES).toEqual(["scheduled", "due_soon", "overdue", "paid"]);
    expect(within(legend()).getByText("Wedding day")).toBeTruthy();
    expect(within(legend()).getByText("Today").closest("li")!.getAttribute("title")).toMatch(/dashed line/);
    expect(within(legend()).getAllByRole("listitem")).toHaveLength(6);
    expect(within(legend()).queryByText(STATUS_LABEL.refund_requested)).toBeNull();
    expect(within(legend()).queryByText(DEADLINE_LEGEND.date_change.label)).toBeNull();
  });

  it("adds a rarer status only while some payment on the chart has it", () => {
    render(<StatusLegend present={["scheduled", "refund_requested"]} />);
    expect(within(legend()).getByText(STATUS_LABEL.refund_requested)).toBeTruthy();
    expect(within(legend()).queryByText(STATUS_LABEL.refunded)).toBeNull();
  });

  it("explains the contract-deadline icons, with the chart's glyphs and colours, while they show", () => {
    render(<StatusLegend showDeadlines />);
    for (const kind of ["date_change", "cancellation"] as const) {
      const item = within(legend()).getByText(DEADLINE_LEGEND[kind].label).closest("li")!;
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

  it("paints each swatch in the status colour the chart's diamonds use", () => {
    const { container } = render(<StatusLegend />);
    const backgrounds = [...container.querySelectorAll<HTMLElement>("li > span[aria-hidden]")].map((el) => el.style.background);
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
    for (const status of LEGEND_STATUSES) expect(backgrounds).toContain(rgb(STATUS_HEX[status]));
  });

  it("matches the colours gantt.css gives the chart's diamonds and the tooltip badge", () => {
    const css = readFileSync(join(process.cwd(), "components/Gantt/gantt.css"), "utf8");
    for (const [status, hex] of Object.entries(STATUS_HEX)) {
      const block = new RegExp(String.raw`\.payment-${status},\s*\.solo-${status}\s*\{\s*--vw-status:\s*([^;]+);`).exec(css);
      expect(block?.[1], status).toBe(hex);
    }
  });
});
