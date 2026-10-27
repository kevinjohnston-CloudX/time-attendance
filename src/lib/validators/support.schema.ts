import { z } from "zod";

/**
 * Help & feedback: what the window sends, checked the same way in the browser
 * and on the server. Who is asking is never part of it; the server reads that
 * from the database (see support.actions.ts).
 */

/** Files and pasted screenshots together stay under the 10 MB a server action
 *  takes, with room for the rest of the request. */
export const SUPPORT_LIMITS = { files: 10, totalBytes: 9 * 1024 * 1024 } as const;

export const SUPPORT_TYPES = ["system_issue", "suggestion", "question"] as const;
export const SUPPORT_IMPACTS = ["idea", "workable", "blocking"] as const;

export const supportRequestSchema = z
  .object({
    requestType: z.enum(SUPPORT_TYPES),
    impact: z.enum(SUPPORT_IMPACTS).default("idea"),
    subject: z.string().trim().min(1, "Add a short summary.").max(300, "Keep the summary under 300 characters."),
    html: z.string().max(SUPPORT_LIMITS.totalBytes).default(""),
    text: z.string().trim().min(1, "Add some details.").max(50000, "The details are too long."),
    pagePath: z.string().max(500).nullish(),
    pageLabel: z.string().max(200).nullish(),
  })
  // Critical is for a system issue that stops work; a question or a suggestion
  // never is. CXT folds it down as well, so this only keeps the two in step.
  .transform((v) => ({
    ...v,
    impact: v.requestType !== "system_issue" && v.impact === "blocking" ? ("workable" as const) : v.impact,
  }));

export type SupportRequestInput = z.input<typeof supportRequestSchema>;
