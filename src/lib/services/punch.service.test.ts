import { describe, expect, it, vi } from "vitest";

const { employee } = vi.hoisted(() => ({ employee: { webPunchEnabled: false } }));
vi.mock("@/lib/db", () => ({
  db: { employee: { findUniqueOrThrow: vi.fn(async () => ({ ...employee, ruleSetId: "r", ruleSet: {}, shift: null, site: { timezone: "America/New_York" }, timeZone: null })) } },
}));
vi.mock("@/lib/engines/segment-builder", () => ({ rebuildSegments: vi.fn() }));
vi.mock("@/lib/utils/timesheet", () => ({ findOrCreateTimesheet: vi.fn() }));
vi.mock("@/lib/audit/logger", () => ({ writeAuditLog: vi.fn() }));
// No open pay period: a punch let through the web check stops here instead.
vi.mock("@/lib/utils/punch-helpers", () => ({ findOpenPayPeriod: vi.fn(async () => null), saveRejectedPunch: vi.fn(), getCurrentPunchState: vi.fn() }));

import { recordPunchCore } from "./punch.service";
import { WEB_PUNCH_OFF, webPunchByDefault } from "@/lib/web-punch";

const punch = (source: "WEB" | "MOBILE" | "KIOSK") => recordPunchCore({ employeeId: "e", tenantId: "t", source }, { punchType: "CLOCK_IN" });

describe("punching from the web", () => {
  it("is refused for someone at the time clock only, from the Punch Clock page and the phone app", async () => {
    employee.webPunchEnabled = false;
    await expect(punch("WEB")).rejects.toThrow(WEB_PUNCH_OFF);
    await expect(punch("MOBILE")).rejects.toThrow(WEB_PUNCH_OFF);
  });

  it("goes through for someone allowed it", async () => {
    employee.webPunchEnabled = true;
    await expect(punch("WEB")).rejects.toThrow("No active pay period");
  });

  it("never stops a time clock punch", async () => {
    employee.webPunchEnabled = false;
    await expect(punch("KIOSK")).rejects.toThrow("No active pay period");
  });

  it("starts on for admins only", () => {
    expect(["EMPLOYEE", "SUPERVISOR", "PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"].map((r) => webPunchByDefault(r as never))).toEqual([false, false, true, true, true, true]);
  });
});
