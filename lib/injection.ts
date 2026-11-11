/**
 * Spots prompt-injection attempts in contract text: words addressed to an AI
 * assistant, attempts to override its instructions, or pressure to pay without
 * asking. Contract PDFs are untrusted input. This check is not the defense (no
 * agent tool can move money, and the model is told to treat documents as
 * data); it makes the attempt visible, to the couple on the vendor page and to
 * the model in read_clause's output, so the answer can call it out.
 *
 * Deterministic and conservative: it needs two different kinds of signal, so
 * ordinary contract language ("the Client shall pay", "notice") doesn't trip it.
 */

type Signal = "addressed_to_ai" | "override" | "act_without_asking";

const SIGNALS: Record<Signal, RegExp[]> = {
  addressed_to_ai: [
    /\b(?:ai|a\.i\.)\s+(?:assistant|agent|model|system)s?\b/i,
    /\b(?:language model|llm|chatbot|assistant reading this)\b/i,
    /\bsystem prompt\b/i,
  ],
  override: [
    /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above|your)\s+instructions?\b/i,
    /\bdisregard\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above|your)\s+(?:instructions?|rules)\b/i,
    /\bnew instructions?\s*:/i,
    /\bdo not (?:mention|tell|reveal|show)\b[^.]{0,40}\b(?:client|couple|user)\b/i,
  ],
  act_without_asking: [
    /\bpre-?approved\b/i,
    /\b(?:pay|transfer|send)\b[^.]{0,40}\b(?:immediately|right away|now|without asking)\b/i,
    /\bmark (?:it|this|the payment) as (?:approved|paid)\b/i,
  ],
};

export type InjectionFinding = {
  /** The kinds of signal found, for tests and logs. */
  signals: Signal[];
  /** A sentence for the couple, never quoting the instruction itself. */
  warning: string;
};

export const INJECTION_WARNING =
  "This part of the contract contains text addressed to an AI assistant, trying to get a payment made without your approval. Vowlet treats contract text as information only, never as instructions, and nothing is ever paid without your approval in PayPal.";

/** A finding when the text looks like an attempt to instruct an AI, otherwise null. */
export function findInjection(text: string): InjectionFinding | null {
  const signals = (Object.keys(SIGNALS) as Signal[]).filter((signal) => SIGNALS[signal].some((pattern) => pattern.test(text)));
  return signals.length >= 2 ? { signals, warning: INJECTION_WARNING } : null;
}
