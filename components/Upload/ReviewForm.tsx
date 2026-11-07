"use client";

import { useState, type ReactNode } from "react";
import { formatCents } from "@/lib/money";
import type { ExtractedTermsView } from "@/lib/upload/client";
import {
  buildReview,
  parseAmount,
  parseDollars,
  pendingConfirmations,
  toDraft,
  type ContractDraft,
  type EvidenceDraft,
  type PaymentDraft,
  type RulesDraft,
  type TierDraft,
} from "@/lib/upload/draft";
import type { ReviewedContract } from "@/lib/upload/schema";

type Props = {
  terms: ExtractedTermsView;
  /** YYYY-MM-DD, the default signing date. */
  today: string;
  /** Saves the reviewed terms. Resolves with an error message, or null on success. */
  onConfirm: (review: ReviewedContract) => Promise<string | null>;
};

const input = "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-300";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-neutral-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

function flagReason(e: EvidenceDraft): string {
  if (!e.quoteVerified) return "The quoted clause wasn't found in the PDF.";
  return `The AI was only ${Math.round(e.confidence * 100)}% sure of this.`;
}

/** The clause the term came from, plus the "Please confirm" flag when needed. */
function Evidence({ e, name, onAcknowledge }: { e: EvidenceDraft; name: string; onAcknowledge: (value: boolean) => void }) {
  return (
    <div className="space-y-2">
      {e.clauseQuote && (
        <blockquote className="rounded border-l-4 border-pink-200 bg-neutral-50 px-2 py-1 text-xs leading-relaxed text-neutral-700">
          &ldquo;{e.clauseQuote}&rdquo; <span className="whitespace-nowrap text-neutral-500">(page {e.page})</span>
        </blockquote>
      )}
      {e.flagged && (
        <div className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs ${e.acknowledged ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${e.acknowledged ? "bg-emerald-100 text-emerald-800" : "bg-amber-200 text-amber-900"}`}>
            {e.acknowledged ? "Confirmed" : "Please confirm"}
          </span>
          <span className="text-neutral-700">{flagReason(e)} Check it against the contract, or edit it.</span>
          <label className="ml-auto flex items-center gap-1 font-medium text-neutral-800">
            <input type="checkbox" checked={e.acknowledged} onChange={(ev) => onAcknowledge(ev.target.checked)} aria-label={`I've checked ${name}`} />
            I&apos;ve checked this
          </label>
        </div>
      )}
    </div>
  );
}

function PaymentRow({ p, index, onChange, onAcknowledge }: { p: PaymentDraft; index: number; onChange: (patch: Partial<PaymentDraft>) => void; onAcknowledge: (v: boolean) => void }) {
  const name = p.label.trim() || `payment ${index + 1}`;
  return (
    <li className={`space-y-2 rounded-md border p-3 ${p.flagged && !p.acknowledged ? "border-amber-300" : "border-neutral-200"}`}>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1.4fr_1fr]">
        <Field label="Payment">
          <input className={input} value={p.label} onChange={(e) => onChange({ label: e.target.value })} aria-label={`Payment ${index + 1} label`} />
        </Field>
        <Field label="Amount ($ or %)">
          <input className={input} value={p.amount} onChange={(e) => onChange({ amount: e.target.value })} aria-label={`${name} amount`} inputMode="decimal" />
        </Field>
        <Field label="Due">
          <select className={input} value={p.anchor} onChange={(e) => onChange({ anchor: e.target.value as PaymentDraft["anchor"] })} aria-label={`${name} due`}>
            <option value="wedding_date">Relative to wedding</option>
            <option value="signing_date">Relative to signing</option>
            <option value="fixed">On a fixed date</option>
          </select>
        </Field>
        {p.anchor === "fixed" ? (
          <Field label="Date">
            <input type="date" className={input} value={p.fixedDate} onChange={(e) => onChange({ fixedDate: e.target.value })} aria-label={`${name} date`} />
          </Field>
        ) : (
          <Field label="Days" hint="Negative = before">
            <input className={input} value={p.offsetDays} onChange={(e) => onChange({ offsetDays: e.target.value })} aria-label={`${name} days`} inputMode="numeric" />
          </Field>
        )}
      </div>
      <Evidence e={p} name={name} onAcknowledge={onAcknowledge} />
    </li>
  );
}

function RulesSection({ title, percentLabel, rules, onChange, onAcknowledge }: { title: string; percentLabel: string; rules: RulesDraft; onChange: (tiers: TierDraft[]) => void; onAcknowledge: (v: boolean) => void }) {
  const setTier = (i: number, patch: Partial<TierDraft>) => onChange(rules.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <section className={`space-y-2 rounded-md border p-3 ${rules.found && rules.flagged && !rules.acknowledged ? "border-amber-300" : "border-neutral-200"}`}>
      <h4 className="text-sm font-semibold">{title}</h4>
      {!rules.found ? (
        <p className="text-sm text-neutral-600">Not in this contract.</p>
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="pr-2 font-medium">Notice (days, at least)</th>
                <th className="pr-2 font-medium">{percentLabel}</th>
                <th className="font-medium">Flat fee ($)</th>
              </tr>
            </thead>
            <tbody>
              {rules.tiers.map((t, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input className={input} value={t.minNoticeDays} onChange={(e) => setTier(i, { minNoticeDays: e.target.value })} aria-label={`${title} tier ${i + 1} notice days`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input className={input} value={t.percent} onChange={(e) => setTier(i, { percent: e.target.value })} aria-label={`${title} tier ${i + 1} percent`} />
                  </td>
                  <td className="py-1">
                    <input className={input} value={t.flatFee} onChange={(e) => setTier(i, { flatFee: e.target.value })} aria-label={`${title} tier ${i + 1} flat fee`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Evidence e={rules} name={title.toLowerCase()} onAcknowledge={onAcknowledge} />
        </>
      )}
    </section>
  );
}

/**
 * The extracted terms of one contract as an editable form. Flagged terms show a
 * "Please confirm" badge, and Confirm stays disabled until each one is edited
 * or ticked "I've checked this" (the server checks this again).
 */
export function ReviewForm({ terms, today, onConfirm }: Props) {
  const [draft, setDraft] = useState<ContractDraft>(() => toDraft(terms, today));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const pending = pendingConfirmations(draft);
  const set = (patch: Partial<ContractDraft>) => setDraft((d) => ({ ...d, ...patch }));
  // Editing a flagged term counts as confirming it.
  const setPayment = (i: number, patch: Partial<PaymentDraft>) =>
    setDraft((d) => ({ ...d, payments: d.payments.map((p, j) => (j === i ? { ...p, ...patch, acknowledged: patch.acknowledged ?? (p.flagged || p.acknowledged) } : p)) }));
  const setRules = (key: "cancellation" | "dateChange", patch: Partial<RulesDraft>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch, acknowledged: patch.acknowledged ?? (d[key].flagged || d[key].acknowledged) } }));

  const totalCents = parseDollars(draft.total);
  const amounts = draft.payments.map((p) => parseAmount(p.amount, totalCents));
  const sum = amounts.every((a) => a !== null) ? amounts.reduce<number>((s, a) => s + (a ?? 0), 0) : null;

  async function confirm() {
    const built = buildReview(draft);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    setSaving(true);
    const error = await onConfirm(built.review);
    setSaving(false);
    if (error) setErrors([error]);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Field label="Vendor">
            <input className={input} value={draft.vendorName} onChange={(e) => set({ vendorName: e.target.value })} />
          </Field>
        </div>
        <Field label="Category">
          <input className={input} value={draft.category} onChange={(e) => set({ category: e.target.value })} />
        </Field>
        <Field label="Total ($)">
          <input className={input} value={draft.total} onChange={(e) => set({ total: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label="Signed on">
          <input type="date" className={input} value={draft.signingDate} onChange={(e) => set({ signingDate: e.target.value })} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-5">
          <Field label="Vendor's PayPal email (optional)" hint="Leave blank to use a sandbox vendor account.">
            <input type="email" className={input} value={draft.paypalEmail} onChange={(e) => set({ paypalEmail: e.target.value })} placeholder="vendor@example.com" />
          </Field>
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold">Payments</h4>
          {sum !== null && totalCents !== null && (
            <p className={`text-xs ${sum === totalCents ? "text-neutral-500" : "text-amber-800"}`} data-testid="payments-sum">
              Payments add up to {formatCents(sum)} of the {formatCents(totalCents)} total{sum === totalCents ? "." : ". Check the amounts."}
            </p>
          )}
        </div>
        <ul className="space-y-2">
          {draft.payments.map((p, i) => (
            <PaymentRow key={i} p={p} index={i} onChange={(patch) => setPayment(i, patch)} onAcknowledge={(v) => setPayment(i, { acknowledged: v })} />
          ))}
        </ul>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <RulesSection
          title="Cancellation"
          percentLabel="Refund %"
          rules={draft.cancellation}
          onChange={(tiers) => setRules("cancellation", { tiers })}
          onAcknowledge={(v) => setRules("cancellation", { acknowledged: v })}
        />
        <RulesSection
          title="Date change"
          percentLabel="Fee % of total"
          rules={draft.dateChange}
          onChange={(tiers) => setRules("dateChange", { tiers })}
          onAcknowledge={(v) => setRules("dateChange", { acknowledged: v })}
        />
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 rounded border border-red-200 bg-red-50 p-2 pl-6 text-sm text-red-800">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {pending.length > 0 && (
          <p className="text-sm text-amber-800" data-testid="pending-confirmations">
            Still to confirm: {pending.join(", ")}
          </p>
        )}
        <button
          type="button"
          onClick={confirm}
          disabled={pending.length > 0 || saving}
          className="rounded-md bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Confirm and add to timeline"}
        </button>
      </div>
    </div>
  );
}
