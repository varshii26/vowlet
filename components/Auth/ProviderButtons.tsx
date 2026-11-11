"use client";

import { useFormStatus } from "react-dom";
import { signInWithGoogle, startDemo } from "@/lib/auth/actions";

/** The pending state of the form this button sits in: disabled, with its label swapped. */
function Submit({ idle, busy, className }: { idle: React.ReactNode; busy: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? busy : idle}
    </button>
  );
}

/** Google's multicolour "G" (their branding guidelines: the mark on a plain white button with a neutral border). */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px]">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** "Continue with Google". Rendered only when Google sign-in is configured. */
export function GoogleButton({ next, label = "Continue with Google" }: { next: string; label?: string }) {
  return (
    <form action={signInWithGoogle}>
      <input type="hidden" name="next" value={next} />
      <Submit
        busy="Opening Google…"
        className="btn w-full gap-2.5 border border-[#dadce0] bg-white py-2.5 text-[#3c4043] hover:bg-[#f8f9fa] disabled:cursor-wait"
        idle={
          <>
            <GoogleMark />
            {label}
          </>
        }
      />
    </form>
  );
}

/** "Try the demo": one click into Priya & Sam's wedding. The primary action for anyone just looking. */
export function DemoButton({ next }: { next: string }) {
  return (
    <form action={startDemo} className="space-y-2">
      <input type="hidden" name="next" value={next} />
      <Submit idle="Try the demo (Priya & Sam)" busy="Opening the demo…" className="btn btn-primary w-full py-3 text-base disabled:cursor-wait" />
      <p className="text-center text-xs text-muted">No sign-up. Test money only.</p>
    </form>
  );
}
