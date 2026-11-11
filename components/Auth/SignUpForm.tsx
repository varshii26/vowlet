"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { Divider } from "@/components/Auth/AuthFrame";
import { GoogleButton } from "@/components/Auth/ProviderButtons";
import { PasswordField } from "@/components/Auth/PasswordField";
import { PasswordRules } from "@/components/Auth/PasswordRules";
import { TextField } from "@/components/Auth/TextField";
import { signUp } from "@/lib/auth/actions";
import { registerSchema } from "@/lib/auth/rules";
import { INITIAL_SIGN_UP, type SignUpField } from "@/lib/auth/sign-up";

type Props = {
  /** Where to go after signing up: already checked by safeNextPath on the server. */
  next: string;
  googleEnabled: boolean;
};

type Errors = Partial<Record<SignUpField, string>>;
const FIELDS = ["name", "email", "password"] as const;
type Field = (typeof FIELDS)[number];

/** The same schema the server checks, so the browser and the server can't disagree about what is valid. */
function problemWith(field: Field, value: string): string | undefined {
  const schema = registerSchema.shape[field];
  const result = field === "name" ? schema.safeParse(value.trim() === "" ? undefined : value) : schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/**
 * The sign-up card: Google first (when configured), then names, email and
 * password. Rules are shown up front. Each field is checked when you leave it, and
 * again on submit (which focuses the first problem instead of disabling the
 * button); the server checks it all again.
 */
export function SignUpForm({ next, googleEnabled }: Props) {
  const [state, formAction, pending] = useActionState(signUp, INITIAL_SIGN_UP);
  const form = useRef<HTMLFormElement>(null);
  // True while our own code moves the cursor. That fires a blur on the field being left, which is not the
  // person leaving it, and after a server answer that field has just been cleared: it must not be flagged.
  const movingFocus = useRef(false);
  const [password, setPassword] = useState("");
  // Problems found in the browser, and the server's answers that the person has since started fixing.
  const [clientErrors, setClientErrors] = useState<Errors>({});
  const [edited, setEdited] = useState<Partial<Record<Field, true>>>({});

  // A new answer from the server: its errors count again, until the field is edited.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setEdited({});
    setClientErrors({});
  }
  const serverError = (field: Field) => (edited[field] ? undefined : state.errors[field]);
  const errorFor = (field: Field) => clientErrors[field] ?? serverError(field);
  const formError = state.errors.form;

  function focusOn(element: Element | RadioNodeList | null | undefined) {
    movingFocus.current = true;
    (element as HTMLElement | null | undefined)?.focus();
    movingFocus.current = false;
  }

  // Put the cursor on the first thing to fix after the server answers.
  useEffect(() => {
    const first = FIELDS.find((field) => state.errors[field]);
    if (first) focusOn(form.current?.elements.namedItem(first));
    else if (state.errors.form) focusOn(form.current?.querySelector("[role=alert]"));
  }, [state]);

  function edit(field: Field, value: string) {
    setEdited((previous) => ({ ...previous, [field]: true }));
    if (field === "password") setPassword(value);
    // A field that now passes loses its browser-side error right away; a new one only appears on leaving the field.
    if (clientErrors[field] && !problemWith(field, value)) setClientErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function leave(field: Field, value: string) {
    if (movingFocus.current) return;
    setClientErrors((previous) => ({ ...previous, [field]: problemWith(field, value) }));
  }

  function check(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const found: Errors = {};
    for (const field of FIELDS) found[field] = problemWith(field, String(data.get(field) ?? ""));
    if (!FIELDS.some((field) => found[field])) return; // fine: the server action runs
    event.preventDefault();
    setClientErrors(found);
    focusOn(event.currentTarget.elements.namedItem(FIELDS.find((field) => found[field])!));
  }

  const taken = state.emailTaken && !edited.email && !clientErrors.email;

  return (
    <>
      {googleEnabled && (
        <>
          <GoogleButton next={next} />
          <Divider>or sign up with email</Divider>
        </>
      )}

      <form ref={form} action={formAction} onSubmit={check} onReset={() => setPassword("")} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />

        {formError && (
          <div role="alert" tabIndex={-1} className="rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800 outline-none focus-visible:outline-2">
            {formError}
          </div>
        )}

        <TextField
          name="name"
          label="Your names (optional)"
          autoComplete="off"
          hint="For example, Priya & Sam."
          defaultValue={state.values.name}
          key={`name-${state.values.name}`}
          error={errorFor("name")}
          onValueChange={(value) => edit("name", value)}
          onBlur={(value) => leave("name", value)}
        />
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values.email}
          key={`email-${state.values.email}`}
          error={
            errorFor("email") && (
              <>
                {errorFor("email")}
                {taken && (
                  <>
                    {" "}
                    <Link href={`/login?email=${encodeURIComponent(state.values.email)}&next=${encodeURIComponent(next)}`} className="underline underline-offset-2">
                      Sign in instead?
                    </Link>
                  </>
                )}
              </>
            )
          }
          onValueChange={(value) => edit("email", value)}
          onBlur={(value) => leave("email", value)}
        />
        <div className="space-y-2">
          <PasswordField
            autoComplete="new-password"
            error={errorFor("password")}
            onValueChange={(value) => edit("password", value)}
            onBlur={(value) => leave("password", value)}
          />
          <PasswordRules password={password} />
        </div>

        <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5 disabled:cursor-wait">
          {pending ? "Creating your account…" : "Create account"}
        </button>
      </form>
    </>
  );
}
