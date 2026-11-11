"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { loginUrl, SESSION_ENDED_MESSAGE } from "@/lib/auth/paths";

/**
 * Tells the person when their session has ended mid-use. Every API route answers
 * 401 once the session is gone, and every place in the app that calls one already
 * shows the server's message; this adds one banner with a way back, keeping their
 * place: the sign-in link carries the page they were on as `next`.
 */
export function SessionWatcher() {
  const pathname = usePathname();
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = new URL(response.url || window.location.href, window.location.href);
      // Only our own API; the sign-in calls themselves answer 401 for a wrong password and are not a lost session.
      if (response.status === 401 && url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) {
        setEnded(true);
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  if (!ended) return null;
  const here = `${pathname}${window.location.search}`;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-ink px-4 py-2.5 text-sm text-canvas">
      <span>{SESSION_ENDED_MESSAGE.replace(" Sign in again.", "")} </span>
      <a href={loginUrl(here)} className="font-semibold underline underline-offset-2">
        Sign in again
      </a>
    </div>
  );
}
