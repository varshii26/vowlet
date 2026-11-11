// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "@/components/Auth/SignInForm";
import type { SignInState } from "@/lib/auth/actions";

// The real actions talk to Auth.js; the form only needs to call them and show what comes back.
const actions = vi.hoisted(() => ({
  signInWithPassword: vi.fn<(previous: SignInState, data: FormData) => Promise<SignInState>>(),
  signInWithGoogle: vi.fn(async () => {}),
  startDemo: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/actions", () => actions);

beforeEach(() => {
  actions.signInWithPassword.mockReset();
  actions.signInWithPassword.mockResolvedValue({ error: null, email: "" });
});
afterEach(cleanup);

const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const password = () => screen.getByLabelText("Password") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /^sign in$|^signing in/i });

async function signIn(emailValue: string, passwordValue: string) {
  fireEvent.change(email(), { target: { value: emailValue } });
  fireEvent.change(password(), { target: { value: passwordValue } });
  await act(async () => {
    fireEvent.click(submit());
  });
}

describe("SignInForm", () => {
  it("leads with the one-click demo, then offers email and password", () => {
    render(<SignInForm next="/" googleEnabled={false} />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons[0]).toBe("Try the demo (Priya & Sam)");
    expect(screen.getByText("No sign-up. Test money only.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("/signup");
  });

  it("labels the fields and tells password managers what they are", () => {
    render(<SignInForm next="/" googleEnabled={false} />);
    expect(email().type).toBe("email");
    expect(email().autocomplete).toBe("email");
    expect(email().required).toBe(true);
    expect(password().autocomplete).toBe("current-password");
    expect(password().required).toBe(true);
    expect(password().type).toBe("password");
  });

  it("shows and hides the password with a real button", () => {
    render(<SignInForm next="/" googleEnabled={false} />);
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(password().type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password().type).toBe("password");
  });

  it("offers Google only when it is configured", () => {
    const { unmount } = render(<SignInForm next="/" googleEnabled={false} />);
    expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
    unmount();
    render(<SignInForm next="/" googleEnabled />);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("carries the safe next path in every form", () => {
    const { container } = render(<SignInForm next="/vendors/abc" googleEnabled />);
    const nexts = [...container.querySelectorAll<HTMLInputElement>("input[name=next]")].map((i) => i.value);
    expect(nexts).toEqual(["/vendors/abc", "/vendors/abc", "/vendors/abc"]); // demo, Google, password
  });

  it("sends the email, password and next to the sign-in action", async () => {
    render(<SignInForm next="/upload" googleEnabled={false} />);
    await signIn("priya@example.com", "a decent passphrase");
    expect(actions.signInWithPassword).toHaveBeenCalledTimes(1);
    const data = actions.signInWithPassword.mock.calls[0][1];
    expect(Object.fromEntries(data.entries())).toEqual({ next: "/upload", email: "priya@example.com", password: "a decent passphrase" });
  });

  it("says Signing in… and disables the button while the attempt is in flight", async () => {
    let finish: (state: SignInState) => void = () => {};
    actions.signInWithPassword.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<SignInForm next="/" googleEnabled={false} />);
    await signIn("a@b.co", "pw");
    const busy = screen.getByRole("button", { name: "Signing in…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => finish({ error: null, email: "a@b.co" }));
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows one message for a failed attempt, announces it, focuses it, and keeps the email", async () => {
    actions.signInWithPassword.mockResolvedValue({ error: "credentials", email: "priya@example.com" });
    render(<SignInForm next="/" googleEnabled={false} />);
    await signIn("priya@example.com", "wrong");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("That email and password don't match.");
    expect(document.activeElement).toBe(alert);
    expect(email().value).toBe("priya@example.com");
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText(/Signed up with Google/)).toBeNull(); // no hint when Google isn't offered
  });

  it("reminds people who signed up with Google, but only when Google is offered", async () => {
    actions.signInWithPassword.mockResolvedValue({ error: "credentials", email: "a@b.co" });
    render(<SignInForm next="/" googleEnabled />);
    await signIn("a@b.co", "wrong");
    expect(screen.getByText("Signed up with Google? Use Continue with Google.")).toBeTruthy();
  });

  it("tells someone who tried too often to wait", async () => {
    actions.signInWithPassword.mockResolvedValue({ error: "rate_limited", email: "a@b.co" });
    render(<SignInForm next="/" googleEnabled />);
    await signIn("a@b.co", "pw");
    expect(screen.getByRole("alert").textContent).toBe("Too many tries. Please wait a minute and try again.");
    expect(screen.queryByText(/Signed up with Google/)).toBeNull();
  });

  it("shows an error that came back in the URL, such as Google's, and focuses it", () => {
    render(<SignInForm next="/" googleEnabled urlError="OAuthAccountNotLinked" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/already an account with that email that uses a password/);
    expect(document.activeElement).toBe(alert);
  });

  it("shows no alert when nothing has gone wrong", () => {
    render(<SignInForm next="/" googleEnabled />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never prints a raw error code", async () => {
    actions.signInWithPassword.mockResolvedValue({ error: "Verification", email: "a@b.co" });
    render(<SignInForm next="/" googleEnabled={false} />);
    await signIn("a@b.co", "pw");
    expect(screen.getByRole("alert").textContent).toBe("Sign-in didn't work. Please try again.");
  });
});
