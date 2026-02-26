import { parseISO } from "date-fns";
import type { AdpWorker } from "./types";

export interface MappedEmployee {
  adpWorkerId: string;
  name: string;
  email: string | null;
  employeeCode: string;
  hireDate: Date;
  isActive: boolean;
  terminatedAt: Date | null;
  /** ADP department name (for display/matching — not a DB ID) */
  adpDepartment: string | null;
  /** ADP location name */
  adpLocation: string | null;
}

/**
 * Map an ADP worker response to our internal employee shape.
 */
export function mapAdpWorker(worker: AdpWorker): MappedEmployee {
  const givenName = worker.person.legalName.givenName ?? "";
  const familyName = worker.person.legalName.familyName1 ?? "";
  const name = `${givenName} ${familyName}`.trim();

  // Prefer business email, fall back to personal
  const bizEmail = worker.businessCommunication?.emails?.[0]?.emailUri;
  const personalEmail = worker.person.communication?.emails?.[0]?.emailUri;
  const email = bizEmail || personalEmail || null;

  const statusCode = worker.workerStatus?.statusCode?.codeValue ?? "";
  const isActive = statusCode.toLowerCase() === "active";

  const hireDateStr = worker.workerDates?.originalHireDate;
  const hireDate = hireDateStr ? parseISO(hireDateStr) : new Date();

  const termDateStr = worker.workerDates?.terminationDate;
  const terminatedAt = termDateStr ? parseISO(termDateStr) : null;

  // Extract department and location from organizational units
  const orgUnits = [
    ...(worker.homeOrganizationalUnits ?? []),
    ...(worker.assignedOrganizationalUnits ?? []),
  ];

  const deptUnit = orgUnits.find(
    (u) => u.typeCode?.codeValue?.toLowerCase() === "department"
  );
  const locUnit = orgUnits.find(
    (u) =>
      u.typeCode?.codeValue?.toLowerCase() === "location" ||
      u.typeCode?.codeValue?.toLowerCase() === "business unit"
  );

  return {
    adpWorkerId: worker.workerID.idValue,
    name,
    email,
    employeeCode: worker.workerID.idValue, // ADP worker ID as employee code
    hireDate,
    isActive,
    terminatedAt: isActive ? null : terminatedAt,
    adpDepartment: deptUnit?.nameCode?.shortName ?? deptUnit?.nameCode?.codeValue ?? null,
    adpLocation: locUnit?.nameCode?.shortName ?? locUnit?.nameCode?.codeValue ?? null,
  };
}

/**
 * Generate a unique username from ADP worker ID.
 * Format: adp-{workerID} to avoid collisions with manually created users.
 */
export function generateUsername(adpWorkerId: string): string {
  return `adp-${adpWorkerId.toLowerCase()}`;
}

/**
 * Generate a random temporary password.
 * Returns the plaintext password (to display to admin) and the bcrypt hash.
 */
export async function generateTempPassword(): Promise<{
  plaintext: string;
  hash: string;
}> {
  const { randomBytes } = await import("node:crypto");
  const { default: bcrypt } = await import("bcryptjs");
  const plaintext =
    randomBytes(12).toString("base64url").slice(0, 16); // 16-char random
  const hash = await bcrypt.hash(plaintext, 12);
  return { plaintext, hash };
}
