import type { Prisma } from "@prisma/client";

/**
 * Leaves out the accounts whose role is limited to Live Attendance. Those are
 * screens and monitoring teams rather than people who work a shift, so they
 * never scan in and would otherwise sit on their home site's roster as
 * permanently "not in".
 */
export const NOT_SCREEN_ACCOUNT: Prisma.EmployeeWhereInput = {
  NOT: [{ customRole: { is: { liveAttendanceOnly: true } } }],
};
