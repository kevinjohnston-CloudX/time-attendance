import {
  EXCEPTION_TYPE_LABEL,
  LEAVE_STATUS_LABEL,
  PUNCH_STATE_LABEL,
  PUNCH_TYPE_LABEL,
  TIMESHEET_STATUS_LABEL,
} from "@/lib/state-machines/labels";
import { PAY_BUCKET_LABEL } from "@/lib/utils/pay-bucket";

/**
 * A stored code as a report reads it: "Supervisor Approved", not
 * SUP_APPROVED. Reports go to HR, into spreadsheets and into email, so they
 * carry the same words every other screen uses, and never the column value.
 *
 * <p>A code nobody has named yet is spelled out ("NEW_CODE" reads "New code")
 * rather than printed raw. The filters still match on the stored code; only
 * what lands in the row changes.
 */

const SEGMENT_TYPE_LABEL: Record<string, string> = { WORK: "Work", MEAL: "Meal", BREAK: "Break", LEAVE: "Leave" };

const PUNCH_SOURCE_LABEL: Record<string, string> = {
  WEB: "Web",
  KIOSK: "Kiosk",
  MOBILE: "Mobile",
  MANUAL: "Manual",
  SYSTEM: "System",
};

const MAPS = {
  timesheetStatus: TIMESHEET_STATUS_LABEL as Record<string, string>,
  leaveStatus: LEAVE_STATUS_LABEL as Record<string, string>,
  punchType: PUNCH_TYPE_LABEL as Record<string, string>,
  punchState: PUNCH_STATE_LABEL as Record<string, string>,
  exceptionType: EXCEPTION_TYPE_LABEL,
  payBucket: PAY_BUCKET_LABEL as Record<string, string>,
  segmentType: SEGMENT_TYPE_LABEL,
  punchSource: PUNCH_SOURCE_LABEL,
} as const;

export function readable(kind: keyof typeof MAPS, code: string | null | undefined): string | null {
  if (code === null || code === undefined || code === "") return null;
  const named = MAPS[kind][code];
  if (named) return named;
  const words = code.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
