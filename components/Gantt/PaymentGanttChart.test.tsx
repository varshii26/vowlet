// @vitest-environment jsdom
import { DateHelper, Widget } from "@bryntum/core-enterprise";
import type { Gantt } from "@bryntum/gantt-enterprise";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentGanttChart, localIsoDay } from "@/components/Gantt/PaymentGanttChart";
import { buildTimeline, withBaseline, type TimelineData, type TimelineInput } from "@/lib/timeline";
import { applyFocus } from "@/lib/timeline-focus";

// Bryntum measures layout and reads these browser APIs while its module loads,
// so they must exist before any import. jsdom has none of them.
vi.hoisted(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const g = globalThis as Record<string, unknown>;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.ResizeObserver = NoopObserver;
  g.IntersectionObserver = NoopObserver;
  // Bryntum's CSS self-check waits on font loading, which jsdom lacks.
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
  g.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
});

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const today = d("2026-11-07");

const input: TimelineInput = {
  wedding: { coupleNames: "Priya & Sam", date: d("2027-04-17") },
  vendors: [
    {
      id: "v1",
      name: "Grand Oak Estate",
      status: "active",
      signingDate: d("2026-06-12"),
      payments: [
        { id: "p1", label: "Venue deposit", amountCents: 300_000, anchor: "signing_date", offsetDays: 0, fixedDate: null, status: "paid", clause: null },
        { id: "p2", label: "Venue balance", amountCents: 300_000, anchor: "wedding_date", offsetDays: -30, fixedDate: null, status: "scheduled", clause: null },
      ],
    },
  ],
};

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

type Extra = { showDeadlines?: boolean; todayIso?: string };

async function mount(data: TimelineInput, onWeddingDateChange?: (iso: string) => void, extra: Extra = {}) {
  host = document.createElement("div");
  host.style.height = "600px";
  host.style.width = "1200px";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<PaymentGanttChart data={buildTimeline(data, today)} onWeddingDateChange={onWeddingDateChange} minWeddingDate="2026-11-07" {...extra} />);
  });
}

async function rerender(data: TimelineInput | TimelineData, extra: Extra = {}) {
  const timeline = "tasks" in data ? data : buildTimeline(data, today);
  await act(async () => {
    root!.render(<PaymentGanttChart data={timeline} {...extra} />);
  });
}

// The part of the Gantt project these tests read. Bryntum's typings leave out
// `commitAsync` and the project's stores, though they exist at runtime.
type TaskRecord = { startDate?: Date; cls: unknown; isMilestone: boolean };
type SettledProject = {
  commitAsync(): Promise<unknown>;
  taskStore: { getById(id: string): TaskRecord | undefined; query(filter: () => boolean): unknown[] };
  dependencyStore: { count: number };
};

/** The mounted Gantt's tasks and dependencies, once the scheduling engine has settled. */
async function engine() {
  const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as Gantt;
  const project = gantt.project as unknown as SettledProject;
  await project.commitAsync();
  const tasks = project.taskStore;
  return {
    tasks,
    dependencyCount: project.dependencyStore.count,
    day: (id: string) => DateHelper.format(tasks.getById(id)!.startDate!, "YYYY-MM-DD"),
    cls: (id: string) => String(tasks.getById(id)!.cls),
  };
}

/** Classes on the wrapper of the bar matching `selector`; the wrapper is what Bryntum colours. */
function wrapClass(selector: string): string {
  const bar = host!.querySelector(`.b-gantt-task${selector}`);
  return bar?.parentElement?.className ?? "";
}

/** Classes on the rollup diamond matching `selector`, drawn in the collapsed vendor row. */
const rollupClass = (selector: string) => host!.querySelector(`.b-task-rollup${selector}`)?.className ?? "";

const barCount = (selector: string) => host!.querySelectorAll(`.b-gantt-task${selector}`).length;

describe("PaymentGanttChart", () => {
  it("mounts in the browser without throwing and renders a Gantt", async () => {
    await mount(input);
    expect(host!.querySelector(".b-gantt")).not.toBeNull();
  });

  it("keeps the Enterprise editing features and the project-end line switched off, even when the wedding drags", async () => {
    await mount(input, () => {});
    const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as Gantt;
    const features = gantt.features as unknown as Record<string, { disabled?: boolean } | undefined>;
    for (const name of ["taskEdit", "taskCopyPaste", "taskSegmentDrag", "taskSegmentResize", "projectLines", "criticalPaths"]) {
      const feature = features[name];
      expect(feature === undefined || feature.disabled === true, name).toBe(true);
    }
    expect(host!.querySelector(".b-gantt-project-line")).toBeNull();
  });

  it("loads our tasks and links, and the scheduling engine leaves our dates alone", async () => {
    await mount(input);
    const { tasks, dependencyCount, day, cls } = await engine();

    // wedding day + 1 vendor + 2 payments
    expect(tasks.query(() => true)).toHaveLength(4);
    expect(dependencyCount).toBe(2);

    // Payment milestones: zero duration, and the dates we computed, not the engine's.
    expect(tasks.getById("payment-p2")!.isMilestone).toBe(true);
    expect(day("payment-p1")).toBe("2026-06-12");
    expect(day("payment-p2")).toBe("2027-03-18");
    expect(day("wedding")).toBe("2027-04-17");

    // Status classes reach the task records, which is what the colours hang on.
    expect(cls("payment-p1")).toContain("payment-paid");
    expect(cls("payment-p2")).toContain("payment-scheduled");
  });

  it("colours each milestone through its wrapper, where Bryntum builds the palette", async () => {
    await mount(input);
    await engine();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // Vendor rows start collapsed: each payment shows as a rollup diamond in
    // its vendor's row, carrying its own status colour.
    expect(rollupClass(".payment-paid")).toContain("b-color-green");
    expect(rollupClass(".payment-scheduled")).toContain("b-color-blue");
    expect(rollupClass(".payment-scheduled")).toContain("b-milestone");
    expect(wrapClass(".wedding")).toContain("b-color-pink");
    expect(barCount(".payment")).toBe(0); // the payment rows themselves are folded away
  });

  it("says what's paid under the vendor's name, in one narrow column, instead of filling the bar", async () => {
    await mount(input);
    await engine();
    const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as Gantt;
    // The timeline itself is a column too; the grid has only the name.
    const fields = (gantt.columns as unknown as { records: { field: string; type: string }[] }).records.filter((c) => c.type !== "timeAxis").map((c) => c.field);
    expect(fields).toEqual(["name"]);
    const vendorCell = [...host!.querySelectorAll(".b-tree-cell-value")].find((el) => el.textContent?.includes("Grand Oak Estate"))!;
    // $3,000 of $6,000 paid
    expect(vendorCell.querySelector(".vw-name-sub")!.textContent).toBe("$3,000 of $6,000 paid");
    expect(host!.querySelector(".b-task-percent-bar[data-percent]:not([data-percent='0'])")).toBeNull();
  });

  it("keeps to months: no Ctrl+wheel or double-click zoom", async () => {
    await mount(input);
    await engine();
    const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as unknown as { zoomOnMouseWheel: boolean; zoomOnTimeAxisDoubleClick: boolean };
    expect(gantt.zoomOnMouseWheel).toBe(false);
    expect(gantt.zoomOnTimeAxisDoubleClick).toBe(false);
  });

  it("draws a labelled wedding line that follows a what-if preview, beside the Today line", async () => {
    await mount(input, undefined, { todayIso: "2026-11-07" });
    await engine();
    const line = () => host!.querySelector<HTMLElement>(".vw-wedding-line")!;
    expect(host!.querySelector(".vw-today-line")).not.toBeNull();
    expect(line().dataset.label).toBe("Wedding · Apr 17");

    await rerender(withBaseline(buildTimeline({ ...input, wedding: { ...input.wedding, date: d("2027-06-12") } }, today), buildTimeline(input, today)), {
      todayIso: "2026-11-07",
    });
    expect(line().dataset.label).toBe("Wedding · Jun 12");
  });

  it("labels the amount still to pay beside its diamond, and leaves paid ones unlabelled (Labels feature)", async () => {
    await mount(input);
    await engine();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as Gantt;
    expect((gantt.features as unknown as { labels?: { disabled: boolean } }).labels?.disabled).toBe(false);
    // The vendor row is collapsed: its right label holds the amounts of its rollups.
    const amounts = [...host!.querySelectorAll(".vw-rollup-amount")].map((el) => el.textContent);
    expect(amounts).toEqual(["$3,000"]); // the scheduled balance; the paid deposit has none
    expect(host!.querySelector(".vw-rollup-amount")!.className).toContain("vw-amount-scheduled");
  });

  it("draws the vendor's contract deadlines as indicators in its row, with our tooltip, when asked to", async () => {
    await mount(withTerms, undefined, { showDeadlines: true });
    await engine();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const indicators = [...host!.querySelectorAll<HTMLElement & { elementData?: { tipHtml: string; href: string } }>(".b-indicator.vw-deadline")];
    expect(indicators.map((el) => el.className.match(/vw-deadline-(\w+)/)![1]).sort()).toEqual(["cancellation", "date_change"]);
    const change = indicators.find((el) => el.className.includes("vw-deadline-date_change"))!;
    expect(change.elementData!.tipHtml).toContain("Last day to change the date for free");
    expect(change.elementData!.href).toContain("c-change");
    // Bryntum's own scheduling indicators stay off.
    expect(host!.querySelectorAll(".b-indicator:not(.vw-deadline)")).toHaveLength(0);
  });

  it("leaves the deadlines off by default, and switches them on and off with the prop", async () => {
    const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 200))));
    await mount(withTerms);
    await engine();
    await settle();
    expect(host!.querySelectorAll(".b-indicator.vw-deadline")).toHaveLength(0);

    await rerender(withTerms, { showDeadlines: true });
    await settle();
    expect(host!.querySelectorAll(".b-indicator.vw-deadline")).toHaveLength(2);

    await rerender(withTerms, { showDeadlines: false });
    await settle();
    expect(host!.querySelectorAll(".b-indicator.vw-deadline")).toHaveLength(0);
  });

  const withTerms: TimelineInput = {
      ...input,
      vendors: [
        {
          ...input.vendors[0],
          terms: {
            dateChange: [
              { minNoticeDays: 60, feePercent: 0, flatFee: 0 },
              { minNoticeDays: 0, feePercent: 25, flatFee: 0 },
            ],
            cancellation: [
              { minNoticeDays: 90, refundPercent: 50, flatFee: 0 },
              { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
            ],
            dateChangeClause: { id: "c-change", page: 2 },
            cancellationClause: { id: "c-cancel", page: 2 },
          },
        },
      ],
  };

  it("picks up a changed payment status when the page re-renders with new data", async () => {
    await mount(input);
    expect((await engine()).cls("payment-p2")).toContain("payment-scheduled");

    // The couple pays the balance: the server re-renders with p2 marked paid.
    await rerender({
      ...input,
      vendors: [
        {
          ...input.vendors[0],
          payments: input.vendors[0].payments.map((p) => (p.id === "p2" ? { ...p, status: "paid" as const } : p)),
        },
      ],
    });
    const after = await engine();

    expect(after.cls("payment-p2")).toContain("payment-paid");
    expect(after.cls("payment-p2")).not.toContain("payment-scheduled");
    // The date is still the one we computed.
    expect(after.day("payment-p2")).toBe("2027-03-18");

    // And what is on screen follows: both milestones are now green, none blue.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const rollups = (selector: string) => host!.querySelectorAll(`.b-task-rollup${selector}`).length;
    expect(rollups(".payment-paid.b-color-green")).toBe(2);
    expect(rollups(".payment-scheduled")).toBe(0);
    expect(rollups(".b-color-blue")).toBe(0);
  });

  describe("dragging the wedding day", () => {
    // The parts of the Gantt and its TaskDrag feature these tests drive. Bryntum's
    // typings don't expose `trigger`'s return value or the feature's validator.
    type Driven = {
      trigger(name: string, args: object): boolean;
      readOnly: boolean;
      features: { taskDrag: { disabled: boolean; validatorFn(records: unknown[], date: Date): unknown } };
    };
    const ganttOf = () => Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as unknown as Driven & Gantt;

    it("is off when nothing listens for a new date", async () => {
      await mount(input);
      expect(ganttOf().readOnly).toBe(true);
      expect(ganttOf().features.taskDrag.disabled).toBe(true);
    });

    it("lets only the wedding milestone be dragged", async () => {
      await mount(input, () => {});
      const { tasks } = await engine();
      const gantt = ganttOf();
      expect(gantt.features.taskDrag.disabled).toBe(false);
      expect(gantt.trigger("beforeTaskDrag", { taskRecord: tasks.getById("wedding") })).not.toBe(false);
      expect(gantt.trigger("beforeTaskDrag", { taskRecord: tasks.getById("payment-p2") })).toBe(false);
      expect(gantt.trigger("beforeTaskDrag", { taskRecord: tasks.getById("vendor-v1") })).toBe(false);
    });

    it("refuses a drop before the earliest allowed day", async () => {
      await mount(input, () => {});
      const validate = ganttOf().features.taskDrag.validatorFn;
      expect(validate([], new Date(2026, 10, 6))).toMatchObject({ valid: false });
      expect(validate([], new Date(2026, 10, 7))).toBe(true);
    });

    it("reports the day the wedding was dropped on", async () => {
      const dropped = vi.fn();
      await mount(input, dropped);
      await engine();
      act(() => {
        ganttOf().trigger("taskDrop", { taskRecords: [{ id: "wedding", startDate: new Date(2027, 5, 12) }] });
      });
      expect(dropped).toHaveBeenCalledWith("2027-06-12");
    });

    it("moves payments when handed a new wedding date, and snaps back when handed the old one", async () => {
      await mount(input, () => {});
      await rerender({ ...input, wedding: { ...input.wedding, date: d("2027-06-12") } });
      let now = await engine();
      expect(now.day("wedding")).toBe("2027-06-12");
      expect(now.day("payment-p2")).toBe("2027-05-13");
      expect(now.day("payment-p1")).toBe("2026-06-12");

      await rerender(input);
      now = await engine();
      expect(now.day("wedding")).toBe("2027-04-17");
      expect(now.day("payment-p2")).toBe("2027-03-18");
    });
  });
});

describe("what-if ghosts (Baselines)", () => {
  const moved = { ...input, wedding: { ...input.wedding, date: d("2027-06-12") } };
  const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 200))));
  // Bryntum pools task elements it no longer shows under `.b-released` (hidden), so skip those.
  const ghosts = () => [...host!.querySelectorAll(".b-task-baseline.vw-ghost")].filter((el) => !el.closest(".b-released"));

  it("draws no ghosts on the saved schedule", async () => {
    await mount(input);
    await engine();
    await settle();
    expect(ghosts()).toHaveLength(0);
  });

  it("draws a ghost at the old date of each moved milestone during a preview, and drops them on cancel", async () => {
    await mount(input);
    await rerender(withBaseline(buildTimeline(moved, today), buildTimeline(input, today)));
    await engine();
    await settle();
    // The wedding day and the wedding-anchored balance moved; the signing deposit didn't.
    expect(ghosts()).toHaveLength(2);

    await rerender(input);
    await engine();
    await settle();
    expect(ghosts()).toHaveLength(0);
  });
});

describe("the vendor name column's tooltip", () => {
  it("shows the full name only when the column cuts it off", async () => {
    await mount(input);
    await engine();
    const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as Gantt;
    expect((gantt.features as unknown as { cellTooltip?: { disabled: boolean } }).cellTooltip?.disabled).toBe(false);

    type Renderer = (data: { cellElement: HTMLElement; record: { name: string } }) => string | undefined;
    const column = ((gantt.columns as unknown as { records: { field: string; tooltipRenderer: Renderer }[] }).records).find((c) => c.field === "name")!;
    // jsdom has no layout, so say whether the text fits by hand.
    const cell = (scrollWidth: number, clientWidth: number) => {
      const el = document.createElement("div");
      el.innerHTML = `<span class="vw-name-main"></span>`;
      const value = el.firstElementChild as HTMLElement;
      Object.defineProperty(value, "scrollWidth", { value: scrollWidth });
      Object.defineProperty(value, "clientWidth", { value: clientWidth });
      return el;
    };
    const record = { name: "Starlight Lighting & <Decor>" };
    expect(column.tooltipRenderer({ cellElement: cell(190, 150), record })).toBe("Starlight Lighting &amp; &lt;Decor&gt;");
    expect(column.tooltipRenderer({ cellElement: cell(120, 150), record })).toBeUndefined();
    expect(column.tooltipRenderer({ cellElement: document.createElement("div"), record })).toBeUndefined();
  });
});

describe("printing the schedule (Print feature)", () => {
  it("hands over a print function that prints every row expanded, then folds the rows back", async () => {
    let print: (() => Promise<void>) | null = null;
    host = document.createElement("div");
    host.style.height = "600px";
    host.style.width = "1200px";
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <PaymentGanttChart data={buildTimeline(input, today)} todayIso="2026-11-07" coupleNames="Priya & Sam" onPrintReady={(fn) => (print = fn)} />,
      );
    });
    await engine();
    expect(print).toBeTypeOf("function");

    const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as Gantt;
    type PrintFeature = { print: (config: object) => Promise<unknown>; disabled: boolean };
    const feature = (gantt.features as unknown as { print: PrintFeature }).print;
    expect(feature.disabled).toBe(false);
    const vendor = () => gantt.taskStore.getById("vendor-v1") as unknown as { isExpanded(store: unknown): boolean };
    const expandedWhilePrinting: boolean[] = [];
    // jsdom can't render a printout; stand in for Bryntum's print() and look at the rows it would see.
    feature.print = vi.fn(async () => void expandedWhilePrinting.push(vendor().isExpanded(gantt.taskStore)));

    expect(vendor().isExpanded(gantt.taskStore)).toBe(false);
    await act(async () => {
      await print!();
    });
    expect(feature.print).toHaveBeenCalledWith(expect.objectContaining({ rowsRange: "all", scheduleRange: "completeview" }));
    expect(expandedWhilePrinting).toEqual([true]);
    expect(vendor().isExpanded(gantt.taskStore)).toBe(false);
  });
});

describe("the agent's focus (TimeRanges, selection, dimming)", () => {
  it("shades the asked-about span, selects the focused row, and dims other rows' deadline icons", async () => {
    const twoVendors: TimelineInput = {
      ...input,
      vendors: [
        { ...input.vendors[0], terms: { dateChange: [{ minNoticeDays: 60, feePercent: 0, flatFee: 0 }], cancellation: [], dateChangeClause: null, cancellationClause: null } },
        {
          id: "v2",
          name: "DJ Marlow Sound",
          status: "active",
          signingDate: d("2026-09-01"),
          payments: [{ id: "p3", label: "DJ booking fee", amountCents: 50_000, anchor: "fixed", offsetDays: 0, fixedDate: d("2026-12-01"), status: "scheduled", clause: null }],
        },
      ],
    };
    const focused = applyFocus(
      buildTimeline(twoVendors, today),
      { vendors: [], paymentIds: ["p3"], range: { from: "2026-11-07", to: "2026-12-07", label: "Due in the next 30 days" }, previewDate: null, refund: null },
      new Set(),
    );
    host = document.createElement("div");
    host.style.height = "600px";
    host.style.width = "1200px";
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<PaymentGanttChart data={focused} timeRanges={focused.timeRanges} focusTaskId={focused.focusTaskId} showDeadlines />);
    });
    await engine();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as Gantt;
    expect((gantt.features as unknown as { timeRanges?: { disabled: boolean } }).timeRanges?.disabled).toBe(false);
    // jsdom has no layout to paint it in; check what Bryntum loaded (it draws in the browser).
    const ranges = (gantt.project as unknown as { timeRangeStore: { records: { name: string; cls: unknown }[] } }).timeRangeStore.records;
    expect(ranges.map((r) => [r.name, String(r.cls).trim()])).toEqual([["Due in the next 30 days", "vw-focus-range"]]);
    expect((gantt as unknown as { selectedRecords: { id: string }[] }).selectedRecords.map((r) => r.id)).toEqual(["vendor-v2"]);
    // Grand Oak isn't in the answer: its deadline icon steps back with its row.
    expect(host!.querySelector(".b-indicator.vw-deadline")!.className).toContain("vw-dim");
  });
});

describe("cash needed each month (Summary footer)", () => {
  const moved = { ...input, wedding: { ...input.wedding, date: d("2027-06-12") } };
  const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 200))));
  const cells = () => [...host!.querySelectorAll(".vw-cash")].map((el) => el.getAttribute("title"));

  it("switches the Summary feature on, with labels in the locked grid", async () => {
    await mount(input);
    await engine();
    await settle();
    const gantt = Widget.fromElement(host!.querySelector(".b-gantt") as HTMLElement) as Gantt;
    const summary = (gantt.features as unknown as Record<string, { disabled?: boolean } | undefined>).summary;
    expect(summary && !summary.disabled).toBe(true);
    expect(host!.textContent).toContain("Cash needed each month");
    // Only the unpaid $3,000 balance; the paid deposit is left out.
    expect(host!.textContent).toContain("$3,000");
  });

  it("shows the unpaid balance in its month, and moves it live during a what-if preview", async () => {
    await mount(input);
    await engine();
    await settle();
    expect(cells()).toEqual(["$3,000 due in March 2027 (the busiest month)"]);

    await rerender(withBaseline(buildTimeline(moved, today), buildTimeline(input, today)));
    await engine();
    await settle();
    expect(cells()).toEqual(["$3,000 due in May 2027 (the busiest month)"]);
  });
});

describe("localIsoDay", () => {
  it("reads the calendar day Bryntum shows, in local time", () => {
    expect(localIsoDay(new Date(2027, 0, 5))).toBe("2027-01-05");
    expect(localIsoDay(new Date(2027, 11, 31, 23, 59))).toBe("2027-12-31");
  });
});
