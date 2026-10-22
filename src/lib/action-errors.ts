/**
 * What a refused or failed change says, in words.
 *
 * <p>Actions answered with codes ("FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED",
 * "Tenant context required"), and most screens showed them as they were. The
 * code travels beside the sentence (`code` on a failed result) for the
 * screens and routes that act on it, such as choosing a 401 or a 404; the
 * sentence is what people read. No server imports: screens use it too.
 */

export type ActionErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "NO_COMPANY";

export const ACTION_ERROR_TEXT = {
  UNAUTHENTICATED: "Your session has ended. Sign in again, then try once more.",
  FORBIDDEN: "You don't have permission to do this.",
  INACTIVE: "Your account is inactive, so you can't make changes. Contact HR if that's not right.",
  MUST_CHANGE_PASSWORD: "Set your new password before making any changes.",
  /**
   * The record was changed or removed meanwhile, or is outside what the
   * person may reach (another site or company). Both read the same, on
   * purpose: telling them apart would say that the record exists.
   */
  NOT_FOUND: "This was changed or removed, or isn't available to you. Reload the page and try again.",
  NO_COMPANY: "Pick a company first, then try again.",
} as const;

/** The code a thrown message stands for, when it is one of the codes rather than a sentence. */
export function codeOfMessage(message: string): ActionErrorCode | null {
  const m = message.trim();
  if (m === "FORBIDDEN" || m === "Insufficient permissions" || m === "Not authorized") return "FORBIDDEN";
  if (m === "NOT_FOUND" || m === "Not found" || m === "Not found.") return "NOT_FOUND";
  if (m === "UNAUTHENTICATED" || m === "Not authenticated" || m === "Unauthorized") return "UNAUTHENTICATED";
  if (/^(Tenant context required|No tenant( context)?|Tenant required)\.?$/i.test(m)) return "NO_COMPANY";
  return null;
}

/** A failed result's sentence for a code. */
export function textOfCode(code: ActionErrorCode): string {
  return ACTION_ERROR_TEXT[code];
}

/**
 * The code of a failed result: its `code`, or the error itself where an
 * action still answers with a bare code ("NOT_LIVE", "ALREADY_SCHEDULED").
 */
export function codeOf(res: { error: string; code?: string }): string {
  return res.code ?? res.error;
}
