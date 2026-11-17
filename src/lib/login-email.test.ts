import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { emailTakenMessage, type EmailHolder } from "./login-email";

/**
 * The banner when an email is taken: admins and Payroll admins are told which
 * record has it, everyone else sees only a name, and nobody learns anything
 * about a person in another company.
 */
const old: EmailHolder = { userId: "u2", name: "Juan Munoz", tenantId: "t1", employeeCode: "ATW106210", wmsId: null, isActive: false, field: "personal" };

describe("email already taken", () => {
  it("tells an admin which record holds it", () => {
    expect(emailTakenMessage("a@gmail.com", old, "t1", true)).toBe("The email a@gmail.com is already the personal email of Juan Munoz (Badge ID ATW106210, inactive).");
    expect(emailTakenMessage("a@x.com", { ...old, wmsId: "106210", isActive: true, field: "work" }, "t1", true)).toBe(
      "The email a@x.com is already the work email of Juan Munoz (Badge ID 106210, active).",
    );
  });

  it("gives everyone else only the name, as before", () => {
    expect(emailTakenMessage("a@gmail.com", old, "t1", false)).toBe("The email a@gmail.com is already used by Juan Munoz.");
  });

  it("never names someone in another company, even to an admin", () => {
    expect(emailTakenMessage("a@gmail.com", old, "t2", true)).toBe("The email a@gmail.com is already used by another account.");
    expect(emailTakenMessage("a@gmail.com", old, "t2", false)).toBe("The email a@gmail.com is already used by another account.");
  });
});
