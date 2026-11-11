"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentFocus } from "@/lib/agent/focus";

type GanttFocus = {
  /** What the latest agent answer is about, shown on the timeline; null shows the plain schedule. */
  focus: AgentFocus | null;
  setFocus: (focus: AgentFocus | null) => void;
  /** Proposals still waiting for the couple: a refund preview lasts only while its proposal does. */
  pendingProposalIds: ReadonlySet<string>;
  /**
   * The timeline registers how to preview a wedding date (the same path as
   * dragging the wedding day); an answer with a preview date calls it.
   */
  registerPreview: (handler: ((isoDate: string) => void) | null) => void;
};

const FocusContext = createContext<GanttFocus | null>(null);

/** Null outside a GanttFocusProvider: the chat and the timeline then work on their own. */
export const useGanttFocus = () => useContext(FocusContext);

/**
 * Shares the agent's focus between the "Ask Vowlet" panel, which sets it from
 * each answer, and the timeline, which shows it. The focus itself is worked
 * out on the server from the tools the agent ran (lib/agent/focus.ts).
 */
export function GanttFocusProvider({ pendingProposalIds, children }: { pendingProposalIds: string[]; children: ReactNode }) {
  const [focus, setFocusState] = useState<AgentFocus | null>(null);
  const previewRef = useRef<((isoDate: string) => void) | null>(null);
  const registerPreview = useCallback((handler: ((isoDate: string) => void) | null) => {
    previewRef.current = handler;
  }, []);
  const setFocus = useCallback((next: AgentFocus | null) => {
    setFocusState(next);
    if (next?.previewDate) previewRef.current?.(next.previewDate);
  }, []);
  const key = pendingProposalIds.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids' contents, not the array's identity
  const pending = useMemo(() => new Set(pendingProposalIds), [key]);
  const value = useMemo(() => ({ focus, setFocus, pendingProposalIds: pending, registerPreview }), [focus, setFocus, pending, registerPreview]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}
