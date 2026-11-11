"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { initialsFor } from "@/lib/auth/avatar";

type Props = {
  name: string | null;
  email: string | null;
  /** The Google profile photo, when the account has one. */
  image: string | null;
  isDemo: boolean;
  /** Minutes of quiet before the shared demo resets itself, for the note in the menu. */
  idleMinutes: number;
};

/**
 * The avatar at the top right and the small menu under it: who you are, and Sign out.
 * A button that opens a menu (Esc closes it and puts focus back on the avatar; so does
 * Tab leaving it and a click elsewhere). Left out of the printed timeline.
 */
export function AccountMenu({ name, email, image, isDemo, idleMinutes }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const signOut = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const initials = initialsFor(name, email);
  const label = name || email || "Account";

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  // Opening puts the cursor on the one action; a click outside closes without stealing focus.
  useEffect(() => {
    if (!open) return;
    signOut.current?.focus();
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div
      ref={root}
      className="vw-no-print relative flex items-center gap-2"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close(true);
        }
      }}
      onBlur={(event) => {
        // Tabbing out of the menu closes it, and focus carries on from where it landed.
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {isDemo && (
        <span className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-accent-strong">Demo account</span>
      )}
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${label}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="grid size-9 place-items-center overflow-hidden rounded-full border border-line bg-accent text-xs font-semibold text-white focus-visible:outline-2"
      >
        {image ? (
          // A remote profile photo of unknown size: a plain img (no optimiser), and no referrer sent to Google.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <span aria-hidden>{initials}</span>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          // z-index above the PayPal button, whose iframe sets 100 and its own menu 300.
          className="absolute right-0 top-full z-[1000] mt-2 w-72 space-y-3 rounded-card border border-line bg-surface p-4 text-left shadow-card"
        >
          <div className="min-w-0 space-y-0.5">
            {name && <p className="truncate text-sm font-semibold text-ink">{name}</p>}
            {email && <p className="truncate text-sm text-muted">{email}</p>}
          </div>
          {isDemo && (
            <p className="text-xs text-muted">
              You&apos;re in the shared demo.{idleMinutes > 0 ? ` Changes reset after ${idleMinutes} idle minutes.` : ""}
            </p>
          )}
          <form action={signOutAction}>
            <button ref={signOut} type="submit" role="menuitem" className="btn btn-secondary w-full">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
