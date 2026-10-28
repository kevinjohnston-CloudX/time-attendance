import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
// Locally there is no key, so an encrypted phone reads as the value below.
vi.mock("@/lib/crypto/pii", () => ({ decryptPii: (v: string) => `decrypted:${v.length}` }));

import { peopleQuerySchema, toPerson } from "./external-people";

const at = (s: string) => new Date(s);

function row(over: { user?: Record<string, unknown>; [k: string]: unknown } = {}) {
  const { user, ...rest } = over;
  return {
    id: "e1",
    employeeCode: "100245",
    wmsId: "100245",
    wmsName: "JANE D",
    barcode: null,
    isActive: true,
    onLeave: false,
    hireDate: at("2024-03-18T00:00:00Z"),
    terminatedAt: null,
    jobTitle: null,
    phone: null,
    phone2: null,
    updatedAt: at("2026-10-01T10:00:00Z"),
    jobTitleRef: null,
    agencyRef: null,
    site: { id: "s1", name: "Main" },
    department: { id: "d1", name: "Receiving" },
    supervisor: null,
    badges: [],
    user: { name: "Jane Doe", username: null, email: null, workEmail: null, updatedAt: at("2026-09-01T10:00:00Z"), ...user },
    ...rest,
  } as unknown as Parameters<typeof toPerson>[0];
}

describe("toPerson", () => {
  it("splits the name at the first space, as the time clocks do", () => {
    expect(toPerson(row({ user: { name: "Maria De La Cruz" } }))).toMatchObject({ firstName: "Maria", lastName: "De La Cruz" });
    expect(toPerson(row({ user: { name: "Prince" } }))).toMatchObject({ firstName: "Prince", lastName: null });
  });

  it("sends a company address saved as the personal email as the work email, once", () => {
    const p = toPerson(row({ user: { email: "Jane.Doe@BergenLogistics.com" } }));
    expect(p).toMatchObject({ workEmail: "Jane.Doe@BergenLogistics.com", personalEmail: null, company: "Bergen" });
  });

  it("keeps both emails when the work one is filled, and reads the company from it", () => {
    const p = toPerson(row({ user: { email: "jane88@gmail.com", workEmail: "jane.doe@cloudxsystems.net" } }));
    expect(p).toMatchObject({ workEmail: "jane.doe@cloudxsystems.net", personalEmail: "jane88@gmail.com", company: "CloudX" });
  });

  it("drops placeholder addresses and leaves the company empty without a company email", () => {
    expect(toPerson(row({ user: { email: "x123@noreply.local", workEmail: "x123@noreply.com" } }))).toMatchObject({ workEmail: null, personalEmail: null, company: null });
    expect(toPerson(row({ user: { email: "jane88@gmail.com" } }))).toMatchObject({ workEmail: null, personalEmail: "jane88@gmail.com", company: null });
  });

  it("sends a plain phone as typed and decrypts an encrypted one", () => {
    const enc = `${"a".repeat(24)}:${"b".repeat(32)}:${"c".repeat(20)}`;
    expect(toPerson(row({ phone: " (201)555-0148 ", phone2: enc }))).toMatchObject({ phone: "(201)555-0148", phone2: `decrypted:${enc.length}` });
  });

  it("reads status as active, on leave or inactive", () => {
    expect(toPerson(row()).status).toBe("active");
    expect(toPerson(row({ onLeave: true })).status).toBe("on_leave");
    expect(toPerson(row({ isActive: false, onLeave: true })).status).toBe("inactive");
  });

  it("dates lastModified from the latest of the record, the login and the badges", () => {
    expect(toPerson(row()).lastModified).toBe("2026-10-01T10:00:00.000Z");
    expect(toPerson(row({ badges: [{ barcode: "1", createdAt: at("2026-10-05T08:00:00Z") }] })).lastModified).toBe("2026-10-05T08:00:00.000Z");
  });
});

describe("peopleQuerySchema", () => {
  it("takes modifiedSince only as a full time with its zone", () => {
    expect(peopleQuerySchema.parse({ modifiedSince: "2026-10-28T00:00:00-04:00" }).modifiedSince?.toISOString()).toBe("2026-10-28T04:00:00.000Z");
    for (const bad of ["yesterday", "2026-10-28", "2026-10-28T00:00:00"]) expect(peopleQuerySchema.safeParse({ modifiedSince: bad }).success).toBe(false);
  });

  it("accepts on_leave as a status", () => {
    expect(peopleQuerySchema.parse({ status: "on_leave" }).status).toBe("on_leave");
  });
});
