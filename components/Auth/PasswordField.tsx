"use client";

import { useId, useState } from "react";

type Props = {
  name?: string;
  label?: string;
  /** "current-password" when signing in, "new-password" when choosing one (so password managers offer the right thing). */
  autoComplete: "current-password" | "new-password";
  /** Text shown under the field: the password rules when signing up. */
  hint?: string;
  error?: string | null;
  required?: boolean;
};

/** A password input with a Show/Hide button. The toggle is a real button: keyboard and screen reader friendly. */
export function PasswordField({ name = "password", label = "Password", autoComplete, hint, error, required = true }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="w-full rounded-control border border-line bg-canvas py-2.5 pl-3 pr-16 text-sm text-ink focus:border-accent/50 focus:outline-none focus-visible:outline-2"
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-pressed={shown}
          aria-controls={id}
          // The visible word is short ("Show"); the name says what is shown, and still contains the visible word.
          aria-label={shown ? "Hide password" : "Show password"}
          className="absolute inset-y-1 right-1 rounded-md px-2.5 text-xs font-medium text-muted hover:bg-sunken hover:text-ink"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
