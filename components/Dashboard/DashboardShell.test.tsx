// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardShell } from "@/components/Dashboard/DashboardShell";

afterEach(cleanup);

describe("DashboardShell", () => {
  it("stacks the agent panel under the main content on narrow screens (and at 200% zoom), side by side from 1280px", () => {
    const { container } = render(<DashboardShell details={{}} main={<p>main</p>} aside={<p>panel</p>} />);
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).toContain("flex-col");
    expect(frame.className).toContain("xl:flex-row");

    const aside = screen.getByRole("complementary", { name: "Ask Vowlet" });
    // Full width and a fixed height below xl (so its message log scrolls); the 26rem sidebar from xl up.
    expect(aside.className).toMatch(/(^| )w-full( |$)/);
    expect(aside.className).toContain("xl:w-[26rem]");
    expect(aside.className).toContain("xl:h-screen");
    // The main column only scrolls itself in the side-by-side layout; otherwise the page scrolls.
    expect(screen.getByRole("main").className).toContain("xl:overflow-y-auto");
    expect(screen.getByRole("main").className).not.toMatch(/(^| )overflow-y-auto/);
  });
});
