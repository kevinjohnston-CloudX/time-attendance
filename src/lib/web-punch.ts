import type { Role } from "@prisma/client";

/**
 * Who may punch from the Punch Clock page: a setting on each person
 * (Employee.webPunchEnabled), off by default so the time clock tablets are the
 * way in. Admins start with it on, as the only people who punched from the web
 * when it came in. Missed punch requests do not depend on it.
 */
export const WEB_PUNCH_ROLES: Role[] = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"];

/** Whether someone new in this role starts with web punching on. */
export function webPunchByDefault(role: Role | null | undefined): boolean {
  return role != null && WEB_PUNCH_ROLES.includes(role);
}

export const WEB_PUNCH_OFF = "Punching from the web is turned off for you. Use the time clock.";
