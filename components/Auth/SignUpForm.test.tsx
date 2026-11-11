// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpForm } from "@/components/Auth/SignUpForm";
import type { SignUpState } from "@/lib/auth/sign-up";

// The real action creates accounts and signs people in; the form only needs to call it and show what comes back.
const actions = vi.hoisted(() => ({
  signUp: vi.fn<(previous: SignUpState, data: FormData) => Promise<SignUpState>>(),
  signInWithGoogle: vi.fn(async () => {}),
  startDemo: vi.fn(async () => {}),
  signInWithPassword: vi.fn(),
}));
vi.mock("@/lib/auth/actions", () => actions);

const empty: SignUpState = { errors: {}, values: { name: "", email: "" }, emailTaken: false };

beforeEach(() => {
  actions.signUp.mockReset();
  actions.signUp.mockResolvedValue(empty);
});
afterEach(cleanup);

const name = () => screen.getByLabelText(/Your names/) as HTMLInputElement;
const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const password = () => screen.getByLabelText("Password") as HTMLInputElement;
const create = () => screen.getByRole("button", { name: /^create account$|^creating your account/i });

const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });
const leave = (input: HTMLInputElement) => fireEvent.blur(input);
const submit = async () =>
  act(async () => {
    fireEvent.click(create());
  });

describe("SignUpForm", () => {
  it("offers Google first, only when it is configured", () => {
    const { unmount } = render(<SignUpForm next="/" googleEnabled={false} />);
    expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
    unmount();
    render(<SignUpForm next="/" googleEnabled />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons[0]).toBe("Continue with Google");
    expect(screen.getByText("or sign up with email")).toBeTruthy();
  });

  it("labels the fields and tells password managers a new password is being chosen", () => {
    render(<SignUpForm next="/" googleEnabled={false} />);
    expect(name().autocomplete).toBe("off");
    expect(name().required).toBe(false);
    expect(email().type).toBe("email");
    expect(email().autocomplete).toBe("email");
    expect(email().required).toBe(true);
    expect(password().autocomplete).toBe("new-password");
    expect(password().required).toBe(true);
  });

  it("shows the password rules before anyone types, and ticks them off as they type", () => {
    render(<SignUpForm next="/" googleEnabled={false} />);
    const rules = screen.getByRole("list", { name: "Password requirements" });
    expect(rules.textContent).toContain("At least 10 characters (not met yet)");
    type(password(), "short");
    expect(rules.textContent).toContain("(not met yet)");
    type(password(), "a decent passphrase");
    expect(rules.textContent).toContain("At least 10 characters (met)");
    type(password(), "x");
    expect(rules.textContent).toContain("(not met yet)"); // and back, if they delete
  });

  it("checks each field when it is left, and clears the error as soon as the fix is typed", () => {
    render(<SignUpForm next="/" googleEnabled={false} />);
    type(email(), "not an email");
    expect(screen.queryByText("Enter a valid email address.")).toBeNull(); // not while still typing
    leave(email());
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(email().getAttribute("aria-invalid")).toBe("true");
    type(email(), "priya@example.com");
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
    expect(email().getAttribute("aria-invalid")).toBeNull();

    type(password(), "short");
    leave(password());
    expect(screen.getByText("Use at least 10 characters.")).toBeTruthy();
  });

  it("ties each error to its field for screen readers", () => {
    render(<SignUpForm next="/" googleEnabled={false} />);
    type(email(), "nope");
    leave(email());
    const error = screen.getByText("Enter a valid email address.");
    expect(email().getAttribute("aria-describedby")).toContain(error.id);
  });

  it("does not send an invalid form, shows every problem, and puts the cursor on the first one", async () => {
    render(<SignUpForm next="/" googleEnabled={false} />);
    await submit(); // everything empty
    expect(actions.signUp).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your email.")).toBeTruthy();
    expect(screen.getByText("Use at least 10 characters.")).toBeTruthy();
    expect(document.activeElement).toBe(email());
    // The button is never disabled to say "no": the form explains instead.
    expect((create() as HTMLButtonElement).disabled).toBe(false);
  });

  it("allows the optional names to stay empty", async () => {
    render(<SignUpForm next="/" googleEnabled={false} />);
    type(email(), "priya@example.com");
    type(password(), "a decent passphrase");
    await submit();
    expect(actions.signUp).toHaveBeenCalledTimes(1);
  });

  it("sends the names, email, password and next to the sign-up action", async () => {
    render(<SignUpForm next="/vendors/abc" googleEnabled={false} />);
    type(name(), "Priya & Sam");
    type(email(), "priya@example.com");
    type(password(), "a decent passphrase");
    await submit();
    const data = actions.signUp.mock.calls[0][1];
    expect(Object.fromEntries(data.entries())).toEqual({ next: "/vendors/abc", name: "Priya & Sam", email: "priya@example.com", password: "a decent passphrase" });
  });

  it("says Creating your account… and disables the button while the request is in flight", async () => {
    let finish: (state: SignUpState) => void = () => {};
    actions.signUp.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<SignUpForm next="/" googleEnabled={false} />);
    type(email(), "a@b.co");
    type(password(), "a decent passphrase");
    await submit();
    const busy = screen.getByRole("button", { name: "Creating your account…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => finish(empty));
    expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(false);
  });

  describe("when the server says no", () => {
    it("shows an existing email with a Sign in instead link that carries the address, keeps it, and focuses it", async () => {
      actions.signUp.mockResolvedValue({
        errors: { email: "There's already an account for that email." },
        values: { name: "Priya & Sam", email: "Priya@Example.com" },
        emailTaken: true,
      });
      render(<SignUpForm next="/upload" googleEnabled={false} />);
      type(email(), "Priya@Example.com");
      type(password(), "a decent passphrase");
      await submit();

      expect(screen.getByText(/There's already an account for that email\./)).toBeTruthy();
      const link = screen.getByRole("link", { name: "Sign in instead?" });
      expect(decodeURIComponent(link.getAttribute("href")!)).toBe("/login?email=Priya@Example.com&next=/upload");
      expect(email().value).toBe("Priya@Example.com");
      expect(name().value).toBe("Priya & Sam");
      expect(document.activeElement).toBe(email());
    });

    it("does not flag the password the person had just typed, though moving the cursor leaves it (regression)", async () => {
      actions.signUp.mockResolvedValue({
        errors: { email: "There's already an account for that email." },
        values: { name: "", email: "priya@example.com" },
        emailTaken: true,
      });
      render(<SignUpForm next="/" googleEnabled={false} />);
      type(email(), "priya@example.com");
      type(password(), "a decent passphrase");
      act(() => password().focus()); // the person pressed Enter in the password field
      await submit();

      // The server's answer cleared the password and moved the cursor to the email field: that is not "leaving the password".
      expect(screen.queryByText("Use at least 10 characters.")).toBeNull();
      expect(password().getAttribute("aria-invalid")).toBeNull();
      expect(document.activeElement).toBe(email());
    });

    it("drops the server's email message, and the link, as soon as the email is edited", async () => {
      actions.signUp.mockResolvedValue({ errors: { email: "There's already an account for that email." }, values: { name: "", email: "priya@example.com" }, emailTaken: true });
      render(<SignUpForm next="/" googleEnabled={false} />);
      type(email(), "priya@example.com");
      type(password(), "a decent passphrase");
      await submit();
      expect(screen.getByRole("link", { name: "Sign in instead?" })).toBeTruthy();
      type(email(), "priya2@example.com");
      expect(screen.queryByText(/already an account/)).toBeNull();
      expect(screen.queryByRole("link", { name: "Sign in instead?" })).toBeNull();
    });

    it("shows server-side field errors the browser didn't catch, each by its field, focusing the first", async () => {
      actions.signUp.mockResolvedValue({
        errors: { name: "That name is too long.", password: "Use at most 200 characters." },
        values: { name: "x", email: "priya@example.com" },
        emailTaken: false,
      });
      render(<SignUpForm next="/" googleEnabled={false} />);
      type(email(), "priya@example.com");
      type(password(), "a decent passphrase");
      await submit();
      expect(screen.getByText("That name is too long.")).toBeTruthy();
      expect(screen.getByText("Use at most 200 characters.")).toBeTruthy();
      expect(document.activeElement).toBe(name());
    });

    it("announces a problem with the whole form, such as too many attempts, and focuses it", async () => {
      actions.signUp.mockResolvedValue({ errors: { form: "Too many sign-up attempts. Please wait a minute and try again." }, values: { name: "", email: "a@b.co" }, emailTaken: false });
      render(<SignUpForm next="/" googleEnabled={false} />);
      type(email(), "a@b.co");
      type(password(), "a decent passphrase");
      await submit();
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("Too many sign-up attempts. Please wait a minute and try again.");
      expect(document.activeElement).toBe(alert);
    });
  });
});
