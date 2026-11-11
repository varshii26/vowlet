// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import NotFound from "@/app/not-found";

afterEach(cleanup);

describe("not-found page", () => {
  it("says what happened and links back to the dashboard", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "We couldn't find that page" })).toBeTruthy();
    expect(screen.getByText(/disappears when the demo is reset/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the dashboard" }).getAttribute("href")).toBe("/");
  });
});

describe("error page", () => {
  it("offers Try again, which retries, and a way back, without showing the error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    render(<ErrorPage error={Object.assign(new Error("secret stack detail"), { digest: "abc123" })} retry={retry} />);

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.queryByText(/secret stack detail/)).toBeNull();
    expect(screen.getByText("Reference: abc123")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Back to the dashboard" }).getAttribute("href")).toBe("/");
  });

  it("shows no reference when there is no digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorPage error={new Error("x")} retry={() => {}} />);
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });
});
