/**
 * The PayPal **sandbox** buyer (Priya & Sam, a US personal account) that judges
 * log in with at checkout. Test money only: it is not a real PayPal account and
 * no card is involved, so it is safe to show in the UI. The README's "Try it"
 * section lists the same login; keep the two in step.
 */
export const SANDBOX_BUYER = {
  email: "vowlet-priya-sam-3fbf@personal.example.com",
  password: "Vwbm17x6T77!",
} as const;
