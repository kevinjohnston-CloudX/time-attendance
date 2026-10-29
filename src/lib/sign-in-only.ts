import type { Prisma } from "@prisma/client";

/**
 * Sign in only accounts: logins with no timecard of their own, such as an
 * agency's viewer or Loss Prevention. Known by the role: a custom role (not a
 * system one) that has permissions but cannot punch for itself. They are made
 * without a badge, shift, pay category, holiday rule or pay, on the rule set
 * named UNASSIGNED (as Juan made the Loss Prevention logins), so they never
 * have a timecard and never reach payroll, absences or exceptions.
 *
 * <p>An agency viewer is a sign in only account with an agency: it sees
 * everyone in that agency (get-subordinate-ids.ts), without being made the
 * supervisor of each of them.
 *
 * <p>A visitor is the other kind of person without a timecard: a custom role
 * with no permissions at all. A visitor holds a badge for the security gate
 * (client-badge.ts) and never signs in.
 */

type PermissionRow = { resource: string; action: string; scope: string };

const PUNCH_OWN = { resource: "punch", action: "write", scope: "own" } as const;

/** The roles of sign in only accounts, as a filter on custom roles. */
export const SIGN_IN_ONLY_ROLE: Prisma.CustomRoleWhereInput = {
  isSystem: false,
  permissions: { some: {}, none: PUNCH_OWN },
};

/** The same test on a role already read with its permissions. */
export function isSignInOnlyRole(role: { isSystem: boolean; permissions: PermissionRow[] }): boolean {
  return (
    !role.isSystem &&
    role.permissions.length > 0 &&
    !role.permissions.some((p) => p.resource === PUNCH_OWN.resource && p.action === PUNCH_OWN.action && p.scope === PUNCH_OWN.scope)
  );
}

/** A visitor's role: one the company made, with no permissions at all. */
export function isVisitorRole(role: { isSystem: boolean; permissions: PermissionRow[] }): boolean {
  return !role.isSystem && role.permissions.length === 0;
}

/** Whether a role looks at a team of people (an agency viewer), not only at itself or the whole company. */
export function seesTeam(role: { permissions: PermissionRow[] }): boolean {
  return role.permissions.some((p) => p.scope === "team");
}

/** The rule set sign in only accounts and visitors are put on. */
export const SIGN_IN_ONLY_RULE_SET = "UNASSIGNED";

/** The department every visitor is filed in. */
export const VISITOR_DEPARTMENT = "Visitors";
