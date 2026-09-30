/**
 * The classic design's status labels: the shared ones, plus the leave badge
 * colours the new design replaced with its Badge tones. Classic keeps prod's
 * Tailwind classes, so its screens look as they did.
 */
import type { LeaveRequestStatusValue } from "@/lib/state-machines/labels";

export * from "@/lib/state-machines/labels";

export const LEAVE_STATUS_BADGE: Record<LeaveRequestStatusValue, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  PENDING_HR: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
  POSTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};
