/**
 * Limits on what the agent accepts. They live in their own file because the
 * browser needs them too (to cap the text box and the history it sends), and the
 * server-side agent code must never be bundled into the page.
 */
export const MAX_QUESTION_CHARS = 500;
export const MAX_HISTORY_TURNS = 8;
export const MAX_TURN_CHARS = 1500;
