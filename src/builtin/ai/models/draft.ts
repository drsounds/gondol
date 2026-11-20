/**
 * A message for the chat's composer, handed over by another app: `setAiDraft(text)`, then open
 * `/ai/new`, and the new conversation's composer starts with it (once). Kept for the tab only.
 */

const KEY = "gondol.ai.draft";

export function setAiDraft(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // storage unavailable: the composer simply starts empty
  }
}

/** The handed-over message, taken (so it's used once); empty when there is none. */
export function takeAiDraft(): string {
  try {
    const text = sessionStorage.getItem(KEY) ?? "";
    sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return "";
  }
}
