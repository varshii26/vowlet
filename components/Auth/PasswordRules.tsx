import { MIN_PASSWORD_LENGTH } from "@/lib/auth/rules";

/**
 * The password rules, shown before anyone types (not only after a failed submit),
 * with a tick for each one that is met as they type. Met and unmet are told apart
 * by words as well as the mark, for screen readers and for colour blindness.
 */
export function PasswordRules({ password }: { password: string }) {
  const rules = [{ label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: password.length >= MIN_PASSWORD_LENGTH }];
  return (
    <ul aria-label="Password requirements" className="space-y-0.5 text-xs">
      {rules.map((rule) => (
        <li key={rule.label} className={`flex items-center gap-1.5 ${rule.met ? "text-emerald-700" : "text-muted"}`}>
          <span aria-hidden="true">{rule.met ? "✓" : "○"}</span>
          {rule.label}
          <span className="sr-only">{rule.met ? " (met)" : " (not met yet)"}</span>
        </li>
      ))}
    </ul>
  );
}
