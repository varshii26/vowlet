"use client";

import { useId, type ReactNode } from "react";

type Props = {
  name: string;
  label: string;
  type?: "text" | "email" | "date";
  autoComplete: string;
  required?: boolean;
  defaultValue?: string;
  /** A short note under the field (an example, or why it is optional). */
  hint?: string;
  error?: ReactNode;
  onValueChange?: (value: string) => void;
  onBlur?: (value: string) => void;
};

/** A labelled input with its hint and error tied to it, so screen readers read them with the field. */
export function TextField({ name, label, type = "text", autoComplete, required = false, defaultValue, hint, error, onValueChange, onBlur }: Props) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={onValueChange ? (event) => onValueChange(event.currentTarget.value) : undefined}
        onBlur={onBlur ? (event) => onBlur(event.currentTarget.value) : undefined}
        className="w-full rounded-control border border-line bg-canvas px-3 py-2.5 text-sm text-ink focus:border-accent/50 focus:outline-none focus-visible:outline-2"
      />
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
