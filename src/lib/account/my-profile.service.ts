import { db } from "@/lib/db";
import { decryptPiiFields } from "@/lib/crypto/pii";
import { getIdBadge, type IdBadge } from "@/lib/badge/badge.service";

/**
 * What the signed in person sees about themselves in My profile.
 *
 * <p>Read only, and only ever their own: both ids come from the session, and
 * the employee row must belong to that same sign in, so nothing a browser
 * sends can point it at somebody else. Pay is left out on purpose (Juan,
 * 2026-11-10). Corrections go through HR, because ADP sync rewrites the
 * employee record and an edit made here would quietly come undone.
 */
export type MyProfile = {
  name: string | null;
  username: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  /** False for a Google only sign in, which has no CloudTime password to change. */
  hasPassword: boolean;
  /** Null for a sign in with no employee record (a super admin, for one). */
  employee: {
    employeeId: string;
    jobTitle: string | null;
    department: string | null;
    building: string | null;
    supervisor: string | null;
    /** The hire date as YYYY-MM-DD: a calendar date, read the same in every time zone. */
    hireDate: string | null;
    phone: string | null;
    otherPhone: string | null;
    /** The address as the lines it is written on, empty when none is on file. */
    address: string[];
    active: boolean;
  } | null;
  badge: IdBadge | null;
};

const US = new Set(["us", "usa", "united states", "united states of america"]);

function addressLines(p: {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
}): string[] {
  const clean = (v: string | null) => v?.trim() || null;
  const city = clean(p.city);
  const state = clean(p.state);
  const zip = clean(p.zipCode);
  const country = clean(p.country);
  const place = [city && state ? `${city}, ${state}` : city ?? state, zip].filter(Boolean).join(" ");
  return [clean(p.address1), clean(p.address2), place || null, country && !US.has(country.toLowerCase()) ? country : null].filter(
    (l): l is string => !!l,
  );
}

export async function getMyProfile(userId: string, employeeId: string | null | undefined): Promise<MyProfile | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, username: true, email: true, workEmail: true, passwordHash: true },
  });
  if (!user) return null;

  // The employee row has to be this sign in's own, not just the id the session carries.
  const row = employeeId
    ? await db.employee.findFirst({
        where: { id: employeeId, userId },
        select: {
          employeeCode: true,
          wmsId: true,
          isActive: true,
          terminatedAt: true,
          hireDate: true,
          jobTitle: true,
          jobTitleRef: { select: { name: true } },
          department: { select: { name: true } },
          site: { select: { name: true } },
          supervisor: { select: { wmsName: true, user: { select: { name: true } } } },
          phone: true,
          phone2: true,
          address1: true,
          address2: true,
          city: true,
          state: true,
          zipCode: true,
          country: true,
        },
      })
    : null;

  const pii = row ? decryptPiiFields(row) : null;
  const badge = row && employeeId ? await getIdBadge(employeeId).catch(() => null) : null;

  return {
    name: user.name?.trim() || null,
    username: user.username?.trim() || null,
    workEmail: user.workEmail?.trim() || null,
    personalEmail: user.email?.trim() || null,
    hasPassword: !!user.passwordHash,
    employee: pii
      ? {
          employeeId: pii.employeeCode,
          jobTitle: pii.jobTitleRef?.name?.trim() || pii.jobTitle?.trim() || null,
          department: pii.department?.name?.trim() || null,
          building: pii.site?.name?.trim() || null,
          supervisor: pii.supervisor?.user?.name?.trim() || pii.supervisor?.wmsName?.trim() || null,
          hireDate: pii.hireDate ? pii.hireDate.toISOString().slice(0, 10) : null,
          phone: pii.phone?.trim() || null,
          otherPhone: pii.phone2?.trim() || null,
          address: addressLines(pii),
          active: pii.isActive && pii.terminatedAt === null,
        }
      : null,
    badge,
  };
}
