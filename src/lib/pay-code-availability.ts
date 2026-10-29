import { db } from "@/lib/db";

/**
 * The pay codes and leave types a person may be given, from their leave
 * policies.
 *
 * <p>A pay code a leave policy hands out (a rule's own pay code, or its leave
 * type's when the rule names none) is someone's only when their pay category
 * has that policy: NJ Sick comes with SCKNX8NJ and CA Sick with SICKCA, so an
 * NJ employee is never given CA Sick, which HR could pick before (Brad Aselta,
 * Michael Brady, 10/9). Leave types work the same way through the policies'
 * rules. Pay codes and leave types no policy hands out are everyone's:
 * Bereavement, Jury Duty, Unpaid Time Off, FMLA, Regular, Overtime.
 *
 * <p>A policy marked inactive still governs its codes, so turning one off
 * takes them from its people rather than handing them to everyone; only an
 * active one gives them.
 */
export type Availability = {
  governedPayCodes: Set<string>;
  allowedPayCodes: Set<string>;
  governedLeaveTypes: Set<string>;
  allowedLeaveTypes: Set<string>;
};

export async function availabilityFor(employeeId: string): Promise<Availability> {
  const employee = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { tenantId: true, payCategoryId: true },
  });
  const [rules, links] = await Promise.all([
    db.ptoPolicyRule.findMany({
      where: { ptoPolicy: { tenantId: employee.tenantId } },
      select: { ptoPolicyId: true, leaveTypeId: true, payCodeId: true, ptoPolicy: { select: { isActive: true } }, leaveType: { select: { payCodeId: true } } },
    }),
    employee.payCategoryId
      ? db.payCategoryPtoPolicy.findMany({ where: { payCategoryId: employee.payCategoryId }, select: { ptoPolicyId: true } })
      : Promise.resolve([]),
  ]);
  const mine = new Set(links.map((l) => l.ptoPolicyId));
  const a: Availability = { governedPayCodes: new Set(), allowedPayCodes: new Set(), governedLeaveTypes: new Set(), allowedLeaveTypes: new Set() };
  for (const r of rules) {
    const payCodeId = r.payCodeId ?? r.leaveType.payCodeId;
    const given = mine.has(r.ptoPolicyId) && r.ptoPolicy.isActive;
    a.governedLeaveTypes.add(r.leaveTypeId);
    if (given) a.allowedLeaveTypes.add(r.leaveTypeId);
    if (payCodeId) {
      a.governedPayCodes.add(payCodeId);
      if (given) a.allowedPayCodes.add(payCodeId);
    }
  }
  return a;
}

export function payCodeAllowed(a: Availability, payCodeId: string): boolean {
  return !a.governedPayCodes.has(payCodeId) || a.allowedPayCodes.has(payCodeId);
}

export function leaveTypeAllowed(a: Availability, leaveTypeId: string): boolean {
  return !a.governedLeaveTypes.has(leaveTypeId) || a.allowedLeaveTypes.has(leaveTypeId);
}

/** Who someone is and what their pay category is called, for a refusal. */
async function whose(employeeId: string): Promise<{ name: string; category: string }> {
  const e = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { user: { select: { name: true } }, payCategory: { select: { description: true } } },
  });
  return { name: e.user?.name ?? "This person", category: e.payCategory?.description?.trim() ?? "no pay category" };
}

/** Refuses a pay code none of the person's leave policies gives them. */
export async function assertPayCodeAllowed(employeeId: string, payCodeId: string): Promise<void> {
  if (payCodeAllowed(await availabilityFor(employeeId), payCodeId)) return;
  const [code, who] = await Promise.all([
    db.payCode.findUniqueOrThrow({ where: { id: payCodeId }, select: { label: true } }),
    whose(employeeId),
  ]);
  throw new Error(
    `${code.label.trim()} isn't on ${who.name}'s leave policies (pay category ${who.category}), so it can't go on their timecard.`,
  );
}

/** Refuses a leave type none of the person's leave policies gives them. */
export async function assertLeaveTypeAllowed(employeeId: string, leaveTypeId: string): Promise<void> {
  if (leaveTypeAllowed(await availabilityFor(employeeId), leaveTypeId)) return;
  const [type, who] = await Promise.all([
    db.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId }, select: { name: true } }),
    whose(employeeId),
  ]);
  throw new Error(`${type.name} isn't on ${who.name}'s leave policies (pay category ${who.category}), so it can't be used for them.`);
}
