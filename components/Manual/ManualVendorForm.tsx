"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { requestSaveManualVendor } from "@/lib/manual/client";
import {
  manualVendorSchema,
  parseDollarsToCents,
  totalOf,
  type ManualPayment,
  type ManualVendor,
} from "@/lib/manual/schema";
import { formatCents } from "@/lib/money";

const CATEGORIES = [
  "Venue",
  "Caterer",
  "Photographer",
  "Videographer",
  "Florist",
  "DJ or band",
  "Planner",
  "Officiant",
  "Baker",
  "Attire",
  "Transport",
  "Other",
];

type DueKind =
  "days_before_wedding" | "days_after_wedding" | "days_after_signing" | "fixed";
type PaymentRow = {
  label: string;
  amount: string;
  kind: DueKind;
  days: string;
  date: string;
};
type CancelRow = { notice: string; refund: string; fee: string };
type ChangeRow = { notice: string; percent: string; fee: string };

const newPayment = (): PaymentRow => ({
  label: "",
  amount: "",
  kind: "days_before_wedding",
  days: "",
  date: "",
});
const newCancel = (): CancelRow => ({ notice: "", refund: "", fee: "" });
const newChange = (): ChangeRow => ({ notice: "", percent: "", fee: "" });

const field =
  "w-full rounded-control border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent/50 focus:outline-none focus-visible:outline-2";
const label = "block text-sm font-medium text-ink";
const err = "text-xs font-medium text-red-700";

/** A whole number of days, or null. Blank counts as zero. */
function wholeNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return 0;
  return /^\d{1,5}$/.test(text) ? Number(text) : null;
}
function decimal(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return 0;
  const n = Number(text);
  return /^\d{1,3}(\.\d{1,2})?$/.test(text) && Number.isFinite(n) ? n : null;
}

function toPayment(row: PaymentRow): ManualPayment | { problem: string } {
  const amountCents = parseDollarsToCents(row.amount);
  if (amountCents === null || amountCents <= 0)
    return { problem: "Enter an amount like 1,500." };
  if (row.kind === "fixed") {
    return {
      label: row.label,
      amountCents,
      anchor: "fixed",
      offsetDays: 0,
      fixedDate: row.date || null,
    };
  }
  const days = wholeNumber(row.days);
  if (days === null)
    return { problem: "Enter the number of days, for example 30." };
  if (row.kind === "days_after_signing")
    return {
      label: row.label,
      amountCents,
      anchor: "signing_date",
      offsetDays: days,
      fixedDate: null,
    };
  return {
    label: row.label,
    amountCents,
    anchor: "wedding_date",
    offsetDays: row.kind === "days_before_wedding" && days !== 0 ? -days : days,
    fixedDate: null,
  };
}

type Saved = { vendorId: string; vendorName: string };

/**
 * For a vendor with no contract to upload: the couple types in who, what and when, and
 * (optionally) what was agreed about cancelling and changing the date. It is saved like
 * an uploaded vendor, then can be printed as a one-page summary to give to the vendor.
 */
export function ManualVendorForm({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [signingDate, setSigningDate] = useState(today);
  const [payments, setPayments] = useState<PaymentRow[]>([newPayment()]);
  const [cancels, setCancels] = useState<CancelRow[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  const total = totalOf(
    payments.flatMap((p) => {
      const c = parseDollarsToCents(p.amount);
      return c ? [{ amountCents: c }] : [];
    }),
  );

  function reset() {
    setVendorName("");
    setCategory("");
    setPaypalEmail("");
    setSigningDate(today);
    setPayments([newPayment()]);
    setCancels([]);
    setChanges([]);
    setNotes("");
    setErrors({});
    setSaved(null);
  }

  const setRow = <T,>(
    list: T[],
    set: (rows: T[]) => void,
    index: number,
    patch: Partial<T>,
  ) => set(list.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};

    const paymentValues: ManualPayment[] = [];
    payments.forEach((row, i) => {
      const result = toPayment(row);
      if ("problem" in result) found[`payment-${i}-amount`] = result.problem;
      else paymentValues.push(result);
    });
    const cancellationRules: ManualVendor["cancellationRules"] = [];
    cancels.forEach((row, i) => {
      const minNoticeDays = wholeNumber(row.notice),
        refundPercent = decimal(row.refund),
        flat = row.fee.trim() === "" ? 0 : parseDollarsToCents(row.fee);
      if (
        minNoticeDays === null ||
        refundPercent === null ||
        flat === null ||
        refundPercent > 100
      )
        found[`cancel-${i}`] =
          "Enter days, a percentage up to 100, and a fee like 100.";
      else
        cancellationRules.push({ minNoticeDays, refundPercent, flatFee: flat });
    });
    const dateChangeRules: ManualVendor["dateChangeRules"] = [];
    changes.forEach((row, i) => {
      const minNoticeDays = wholeNumber(row.notice),
        feePercent = decimal(row.percent),
        flat = row.fee.trim() === "" ? 0 : parseDollarsToCents(row.fee);
      if (
        minNoticeDays === null ||
        feePercent === null ||
        flat === null ||
        feePercent > 100
      )
        found[`change-${i}`] =
          "Enter days, a percentage up to 100, and a fee like 100.";
      else dateChangeRules.push({ minNoticeDays, feePercent, flatFee: flat });
    });

    // The server's own schema checks the rest, so the browser and the server can't disagree.
    const candidate = {
      vendorName,
      category,
      paypalEmail: paypalEmail.trim(),
      signingDate,
      payments: paymentValues,
      cancellationRules,
      dateChangeRules,
      notes,
    };
    const parsed = manualVendorSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [head, index, tail] = issue.path;
        const key =
          head === "payments"
            ? `payment-${String(index)}-${tail === "label" ? "label" : tail === "fixedDate" ? "date" : "amount"}`
            : String(head);
        found[key] ??= issue.message;
      }
    }
    if (Object.keys(found).length > 0 || !parsed.success) {
      setErrors(found);
      // Put the cursor on the first thing to fix.
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>("[aria-invalid=true]")
          ?.focus(),
      );
      return;
    }

    setErrors({});
    setSaving(true);
    const result = await requestSaveManualVendor(parsed.data);
    setSaving(false);
    if (result.ok)
      setSaved({ vendorId: result.vendorId, vendorName: result.vendorName });
    else setErrors({ form: result.message });
  }

  if (!open) {
    return (
      <section
        aria-labelledby={`${id}-title`}
        className="rounded-card border border-line bg-surface p-5"
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
          No contract to upload?
        </h2>
        <p className="mt-1 text-sm text-muted">
          Type in the vendor, what you pay and when. You can then print a
          one-page summary to give to them.
        </p>
        <button
          type="button"
          className="btn btn-secondary mt-3"
          onClick={() => setOpen(true)}
        >
          Enter a vendor by hand
        </button>
      </section>
    );
  }

  if (saved) {
    return (
      <section
        role="status"
        aria-labelledby={`${id}-saved`}
        className="space-y-3 rounded-card border border-line bg-surface p-5"
      >
        <h2 id={`${id}-saved`} className="text-lg font-semibold text-ink">
          {saved.vendorName} is on your timeline
        </h2>
        <p className="text-sm text-muted">
          Print the summary and give it to them, so you both have the same
          schedule on paper.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/vendors/${encodeURIComponent(saved.vendorId)}/print`}
            className="btn btn-primary"
          >
            Print summary for the vendor
          </Link>
          <Link href="/" className="btn btn-secondary">
            Back to the dashboard
          </Link>
          <button type="button" className="btn btn-secondary" onClick={reset}>
            Add another vendor
          </button>
        </div>
      </section>
    );
  }

  const input = (
    name: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <input
      {...props}
      name={name}
      aria-invalid={errors[name] ? true : undefined}
      aria-describedby={errors[name] ? `${id}-${name}-err` : undefined}
      className={field}
    />
  );
  const fieldError = (name: string) =>
    errors[name] && (
      <p id={`${id}-${name}-err`} className={err}>
        {errors[name]}
      </p>
    );

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-card border border-line bg-surface p-5"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
        Enter a vendor by hand
      </h2>
      <form
        ref={formRef}
        onSubmit={submit}
        className="mt-4 space-y-6"
        noValidate
      >
        {errors.form && (
          <div
            role="alert"
            className="rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800"
          >
            {errors.form}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-vendorName`} className={label}>
              Vendor name
            </label>
            {input("vendorName", {
              id: `${id}-vendorName`,
              value: vendorName,
              onChange: (e) => setVendorName(e.target.value),
              autoComplete: "off",
              required: true,
            })}
            {fieldError("vendorName")}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-category`} className={label}>
              Category
            </label>
            {input("category", {
              id: `${id}-category`,
              value: category,
              onChange: (e) => setCategory(e.target.value),
              list: `${id}-categories`,
              autoComplete: "off",
              required: true,
            })}
            <datalist id={`${id}-categories`}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {fieldError("category")}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-signingDate`} className={label}>
              Date you agreed with them
            </label>
            {input("signingDate", {
              id: `${id}-signingDate`,
              type: "date",
              value: signingDate,
              onChange: (e) => setSigningDate(e.target.value),
            })}
            <p className="text-xs text-muted">
              Payments due &ldquo;after signing&rdquo; count from this date.
            </p>
            {fieldError("signingDate")}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-paypalEmail`} className={label}>
              Their PayPal email (optional)
            </label>
            {input("paypalEmail", {
              id: `${id}-paypalEmail`,
              type: "email",
              value: paypalEmail,
              onChange: (e) => setPaypalEmail(e.target.value),
              autoComplete: "off",
            })}
            <p className="text-xs text-muted">
              Leave blank to use a sandbox vendor account while testing.
            </p>
            {fieldError("paypalEmail")}
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">Payments</legend>
          {payments.map((row, i) => (
            <div
              key={i}
              className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[1.4fr_0.8fr_1.2fr_auto]"
            >
              <div className="space-y-1.5">
                <label htmlFor={`${id}-p${i}-label`} className={label}>
                  Payment {i + 1}
                </label>
                {input(`payment-${i}-label`, {
                  id: `${id}-p${i}-label`,
                  value: row.label,
                  placeholder: "Deposit",
                  onChange: (e) =>
                    setRow(payments, setPayments, i, { label: e.target.value }),
                })}
                {fieldError(`payment-${i}-label`)}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-p${i}-amount`} className={label}>
                  Amount ($)
                </label>
                {input(`payment-${i}-amount`, {
                  id: `${id}-p${i}-amount`,
                  value: row.amount,
                  inputMode: "decimal",
                  placeholder: "1,500",
                  onChange: (e) =>
                    setRow(payments, setPayments, i, {
                      amount: e.target.value,
                    }),
                })}
                {fieldError(`payment-${i}-amount`)}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-p${i}-kind`} className={label}>
                  Due
                </label>
                <div className="flex gap-2">
                  <select
                    id={`${id}-p${i}-kind`}
                    className={field}
                    value={row.kind}
                    onChange={(e) =>
                      setRow(payments, setPayments, i, {
                        kind: e.target.value as DueKind,
                      })
                    }
                  >
                    <option value="days_before_wedding">
                      days before the wedding
                    </option>
                    <option value="days_after_wedding">
                      days after the wedding
                    </option>
                    <option value="days_after_signing">
                      days after signing (0 = on signing)
                    </option>
                    <option value="fixed">on a set date</option>
                  </select>
                  {row.kind === "fixed" ? (
                    input(`payment-${i}-date`, {
                      type: "date",
                      "aria-label": `Payment ${i + 1} date`,
                      value: row.date,
                      onChange: (e) =>
                        setRow(payments, setPayments, i, {
                          date: e.target.value,
                        }),
                    })
                  ) : (
                    <input
                      aria-label={`Payment ${i + 1} days`}
                      inputMode="numeric"
                      placeholder="30"
                      className={`${field} max-w-20`}
                      value={row.days}
                      onChange={(e) =>
                        setRow(payments, setPayments, i, {
                          days: e.target.value,
                        })
                      }
                    />
                  )}
                </div>
                {fieldError(`payment-${i}-date`)}
              </div>
              <div className="flex items-end">
                {payments.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-secondary px-3 py-2 text-xs"
                    onClick={() =>
                      setPayments(payments.filter((_, k) => k !== i))
                    }
                    aria-label={`Remove payment ${i + 1}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setPayments([...payments, newPayment()])}
            >
              Add a payment
            </button>
            <p className="text-sm text-ink" aria-live="polite">
              Total:{" "}
              <span className="font-semibold tabular-nums">
                {formatCents(total)}
              </span>
            </p>
          </div>
          {fieldError("payments")}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">
            If you cancel (optional)
          </legend>
          <p className="text-xs text-muted">
            What did they agree to give back? Add a line for each notice period.
            Without these, the refund helper says there are no terms on file.
          </p>
          {cancels.map((row, i) => (
            <div
              key={i}
              className="flex flex-wrap items-end gap-3 rounded-control border border-line p-3"
            >
              <label className="text-sm">
                With at least{" "}
                <input
                  aria-label={`Cancellation ${i + 1} notice days`}
                  className={`${field} mx-1 inline-block w-20`}
                  inputMode="numeric"
                  value={row.notice}
                  onChange={(e) =>
                    setRow(cancels, setCancels, i, { notice: e.target.value })
                  }
                />{" "}
                days&apos; notice, refund
              </label>
              <label className="text-sm">
                <input
                  aria-label={`Cancellation ${i + 1} refund percent`}
                  className={`${field} mx-1 inline-block w-20`}
                  inputMode="decimal"
                  value={row.refund}
                  onChange={(e) =>
                    setRow(cancels, setCancels, i, { refund: e.target.value })
                  }
                />
                % of what you paid, minus $
              </label>
              <input
                aria-label={`Cancellation ${i + 1} fee`}
                className={`${field} w-24`}
                inputMode="decimal"
                placeholder="0"
                value={row.fee}
                onChange={(e) =>
                  setRow(cancels, setCancels, i, { fee: e.target.value })
                }
              />
              <button
                type="button"
                className="btn btn-secondary px-3 py-2 text-xs"
                aria-label={`Remove cancellation line ${i + 1}`}
                onClick={() => setCancels(cancels.filter((_, k) => k !== i))}
              >
                Remove
              </button>
              {fieldError(`cancel-${i}`)}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCancels([...cancels, newCancel()])}
          >
            Add a cancellation line
          </button>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">
            If the wedding date changes (optional)
          </legend>
          <p className="text-xs text-muted">
            What fee do they charge to move the date? Without these, the what-if
            planner shows no fee for this vendor.
          </p>
          {changes.map((row, i) => (
            <div
              key={i}
              className="flex flex-wrap items-end gap-3 rounded-control border border-line p-3"
            >
              <label className="text-sm">
                With at least{" "}
                <input
                  aria-label={`Date change ${i + 1} notice days`}
                  className={`${field} mx-1 inline-block w-20`}
                  inputMode="numeric"
                  value={row.notice}
                  onChange={(e) =>
                    setRow(changes, setChanges, i, { notice: e.target.value })
                  }
                />{" "}
                days&apos; notice, fee
              </label>
              <label className="text-sm">
                <input
                  aria-label={`Date change ${i + 1} fee percent`}
                  className={`${field} mx-1 inline-block w-20`}
                  inputMode="decimal"
                  value={row.percent}
                  onChange={(e) =>
                    setRow(changes, setChanges, i, { percent: e.target.value })
                  }
                />
                % of the total, plus $
              </label>
              <input
                aria-label={`Date change ${i + 1} flat fee`}
                className={`${field} w-24`}
                inputMode="decimal"
                placeholder="0"
                value={row.fee}
                onChange={(e) =>
                  setRow(changes, setChanges, i, { fee: e.target.value })
                }
              />
              <button
                type="button"
                className="btn btn-secondary px-3 py-2 text-xs"
                aria-label={`Remove date change line ${i + 1}`}
                onClick={() => setChanges(changes.filter((_, k) => k !== i))}
              >
                Remove
              </button>
              {fieldError(`change-${i}`)}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setChanges([...changes, newChange()])}
          >
            Add a date-change line
          </button>
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-notes`} className={label}>
            Notes for the vendor (optional, printed on the summary)
          </label>
          <textarea
            id={`${id}-notes`}
            className={field}
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary disabled:cursor-wait"
          >
            {saving ? "Saving…" : "Save vendor"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
