/**
 * Another employee's setup to start a new hire from: assignments and policy
 * only. Nothing that identifies the person (name, email, codes, badge, hire
 * date, personal details) and not their pay rate.
 */
export type CopyFromEmployee = {
  sourceName: string;
  role: string;
  siteId: string;
  departmentId: string;
  supervisorId: string | null;
  jobTitleId: string | null;
  agencyId: string | null;
  ruleSetId: string;
  shiftId: string | null;
  holidayRuleId: string | null;
  payCategoryId: string | null;
  payTypeId: string | null;
  payType: "HOURLY" | "SALARY" | null;
};

type Source = {
  user: { name: string | null };
  role: string;
  customRoleId: string | null;
  siteId: string;
  departmentId: string;
  supervisorId: string | null;
  jobTitleId: string | null;
  agencyId: string | null;
  ruleSetId: string;
  shiftId: string | null;
  holidayRuleId: string | null;
  payCategoryId: string | null;
  payTypeId: string | null;
  payType: string | null;
};

/** Null when the source is not at one of this company's sites. */
export function toCopyFromEmployee(
  src: Source | null,
  sites: { id: string }[],
  customRoles: { id: string }[],
): CopyFromEmployee | null {
  if (!src || !sites.some((s) => s.id === src.siteId)) return null;
  return {
    sourceName: src.user.name ?? "another employee",
    // The role dropdown lists every active role by id, the system ones too.
    role: src.customRoleId && customRoles.some((r) => r.id === src.customRoleId) ? `custom:${src.customRoleId}` : src.role,
    siteId: src.siteId,
    departmentId: src.departmentId,
    supervisorId: src.supervisorId,
    jobTitleId: src.jobTitleId,
    agencyId: src.agencyId,
    ruleSetId: src.ruleSetId,
    shiftId: src.shiftId,
    holidayRuleId: src.holidayRuleId,
    payCategoryId: src.payCategoryId,
    payTypeId: src.payTypeId,
    payType: src.payType === "HOURLY" || src.payType === "SALARY" ? src.payType : null,
  };
}
