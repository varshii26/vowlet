// @vitest-environment jsdom
import { DateHelper, Widget } from "@bryntum/core-community";
import type { Gantt } from "@bryntum/gantt-community";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentGanttChart } from "@/components/Gantt/PaymentGanttChart";
import { buildTimeline, type TimelineInput } from "@/lib/timeline";

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

async function mount(data: TimelineInput) {
  host = document.createElement("div");
  host.style.height = "600px";
  host.style.width = "1200px";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<PaymentGanttChart data={buildTimeline(data, today)} />);
  });
}

async function rerender(data: TimelineInput) {
  await act(async () => {
    root!.render(<PaymentGanttChart data={buildTimeline(data, today)} />);
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

const barCount = (selector: string) => host!.querySelectorAll(`.b-gantt-task${selector}`).length;

describe("PaymentGanttChart", () => {
  it("mounts in the browser without throwing and renders a Gantt", async () => {
    await mount(input);
    expect(host!.querySelector(".b-gantt")).not.toBeNull();
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

    expect(wrapClass(".payment-paid")).toContain("b-color-green");
    expect(wrapClass(".payment-scheduled")).toContain("b-color-blue");
    expect(wrapClass(".wedding")).toContain("b-color-pink");
    expect(wrapClass(".payment-scheduled")).toContain("b-milestone-wrap");
  });

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
    expect(barCount(".payment-paid")).toBe(2);
    expect(barCount(".payment-scheduled")).toBe(0);
    expect(host!.querySelectorAll(".b-gantt-task-wrap.b-color-green")).toHaveLength(2);
    expect(host!.querySelectorAll(".b-gantt-task-wrap.b-color-blue")).toHaveLength(0);
  });
});
