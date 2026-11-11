// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/Account/AccountMenu";

const actions = vi.hoisted(() => ({ signOutAction: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/actions", () => actions);

afterEach(cleanup);

const real = { name: "Ana & Ben", email: "ana@example.com", image: null, isDemo: false, idleMinutes: 30 };
const demo = { name: "Demo (Priya & Sam)", email: "demo@vowlet.invalid", image: null, isDemo: true, idleMinutes: 30 };
const avatar = () => screen.getByRole("button", { name: /account menu/i });

describe("AccountMenu", () => {
  it("shows initials on the avatar, and the menu is closed until it is used", () => {
    render(<AccountMenu {...real} />);
    expect(avatar().textContent).toBe("AB");
    expect(avatar().getAttribute("aria-haspopup")).toBe("menu");
    expect(avatar().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the Google photo instead of initials when there is one, without a referrer", () => {
    const { container } = render(<AccountMenu {...real} image="https://lh3.googleusercontent.com/a/photo" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://lh3.googleusercontent.com/a/photo");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("alt")).toBe("");
  });

  it("opens a menu with the name, the email and Sign out, and moves focus to Sign out", () => {
    render(<AccountMenu {...real} />);
    fireEvent.click(avatar());
    expect(avatar().getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("Ana & Ben");
    expect(menu.textContent).toContain("ana@example.com");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Sign out" }));
  });

  it("closes on Escape and puts focus back on the avatar", () => {
    render(<AccountMenu {...real} />);
    fireEvent.click(avatar());
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Sign out" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(avatar());
  });

  it("closes on a click outside, and when the avatar is clicked again", () => {
    render(<AccountMenu {...real} />);
    fireEvent.click(avatar());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(avatar());
    fireEvent.click(avatar());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("signs out from the menu", () => {
    render(<AccountMenu {...real} />);
    fireEvent.click(avatar());
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(actions.signOutAction).toHaveBeenCalledTimes(1);
  });

  it("is left out of the printout", () => {
    const { container } = render(<AccountMenu {...real} />);
    expect(container.firstElementChild?.classList.contains("vw-no-print")).toBe(true);
  });

  it("a real account has no demo chip or demo note", () => {
    render(<AccountMenu {...real} />);
    fireEvent.click(avatar());
    expect(screen.queryByText("Demo account")).toBeNull();
    expect(screen.queryByText(/shared demo/)).toBeNull();
  });

  it("the demo account gets a chip and the shared-demo note", () => {
    render(<AccountMenu {...demo} />);
    expect(screen.getByText("Demo account")).toBeTruthy();
    fireEvent.click(avatar());
    expect(screen.getByRole("menu").textContent).toContain("You're in the shared demo. Changes reset after 30 idle minutes.");
  });

  it("drops the idle sentence when auto-reset is switched off", () => {
    render(<AccountMenu {...demo} idleMinutes={0} />);
    fireEvent.click(avatar());
    const text = screen.getByRole("menu").textContent!;
    expect(text).toContain("You're in the shared demo.");
    expect(text).not.toContain("idle");
  });
});
