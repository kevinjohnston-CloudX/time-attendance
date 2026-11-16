import type { Prisma } from "@prisma/client";

/**
 * The Manager role (HR, 11/16): a supervisor who also changes their people's
 * timecards directly and approves supervisors' changes, so it holds
 * Supervisor's permissions and changing the team's punches and timecards
 * (migration 20261116120000_manager_role).
 *
 * <p>Besides the people who report to them, a Manager may be given more on
 * their employee record's Site Access card: sites (HrSiteAccess) and
 * departments (ManagerDepartmentAccess).
 * <ul>
 *   <li>nothing checked: their reporting chain only, as a Supervisor;</li>
 *   <li>sites only: everyone at those sites;</li>
 *   <li>departments only: those departments at every site;</li>
 *   <li>both: those departments at those sites.</li>
 * </ul>
 * Read only while the person is on this role, so someone moved off it keeps
 * their rows and sees none of it. Its rank is Supervisor's: ranks are whole
 * numbers and Payroll Admin's is the next.
 */
export const MANAGER_ROLE_NAME = "Manager";

/** The role, as a filter on an employee's custom role. */
export const MANAGER_ROLE: Prisma.CustomRoleWhereInput = { isSystem: true, isActive: true, name: MANAGER_ROLE_NAME };

export function isManagerRole(role: { name: string; isSystem: boolean } | null | undefined): boolean {
  return !!role && role.isSystem && role.name === MANAGER_ROLE_NAME;
}

/**
 * The people a Manager sees through their departments and sites, as a filter
 * on employees: nobody for anyone else, or a Manager with nothing checked.
 * Relational, so it sits inside a synchronous filter (directReportsOf).
 */
export function managerAccessOf(managerEmployeeId: string): Prisma.EmployeeWhereInput {
  const manager: Prisma.EmployeeWhereInput = { customRole: { is: MANAGER_ROLE } };
  return {
    OR: [
      // Sites only: everyone at them.
      { site: { hrAccess: { some: { employeeId: managerEmployeeId, employee: { ...manager, managerDepartments: { none: {} } } } } } },
      // Departments only: those departments at every site.
      { department: { managerAccess: { some: { employeeId: managerEmployeeId, employee: { ...manager, siteAccess: { none: {} } } } } } },
      // Both: those departments at those sites.
      {
        AND: [
          { site: { hrAccess: { some: { employeeId: managerEmployeeId, employee: manager } } } },
          { department: { managerAccess: { some: { employeeId: managerEmployeeId } } } },
        ],
      },
    ],
  };
}
