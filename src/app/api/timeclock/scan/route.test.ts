import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The security scan endpoint and a guard's stated direction (2026-11-10).
 *
 * The security phone's batch mode lets the guard say a group is Entering or
 * Leaving. That arrives as `Direction` and is handed to recordScanEvent as
 * `knownDirection`; a tablet never sends it, and its scans alternate as before.
 */

const recordScanEvent = vi.fn();

vi.mock("@/lib/api/timeclock-auth", () => ({ timeclockKeyValid: () => true }));
vi.mock("@/lib/utils/badge-lookup", () => ({ findEmployeeIdentityByBadge: async () => ({ id: "e1" }) }));
vi.mock("@/lib/utils/tablet-time-zone", () => ({ tabletTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/utils/person-time-zone", () => ({ personTimeZone: () => "America/New_York" }));
vi.mock("@/lib/services/scan-event.service", () => ({ recordScanEvent: (input: unknown) => recordScanEvent(input) }));

import { POST } from "./route";

const base = {
  EmployeeCode: "107538",
  ScanDateTime: "2026-11-10T17:20:00.000-0500",
  Stream: "SECURITY",
  DeviceName: "phone_security_NJ3",
  Warehouse: 5,
};

function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/timeclock/scan", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));
}

beforeEach(() => {
  recordScanEvent.mockReset();
  recordScanEvent.mockImplementation(async (input: { knownDirection?: string }) => ({
    id: "s1",
    direction: input.knownDirection ?? "OUT",
    employeeId: "e1",
    employeeName: "Test",
    duplicate: false,
    reread: false,
    legacyMismatch: false,
  }));
});

describe("a guard's stated direction at security", () => {
  it("passes Entering through as a known IN", async () => {
    const res = await post({ ...base, Direction: "IN" });
    expect(res.status).toBe(200);
    expect(recordScanEvent).toHaveBeenCalledTimes(1);
    expect(recordScanEvent.mock.calls[0][0].knownDirection).toBe("IN");
    expect((await res.json()).direction).toBe("IN");
  });

  it("passes Leaving through as a known OUT", async () => {
    await post({ ...base, Direction: "OUT" });
    expect(recordScanEvent.mock.calls[0][0].knownDirection).toBe("OUT");
  });

  it("leaves a tablet's scan to alternation when no direction is sent", async () => {
    await post(base);
    expect(recordScanEvent.mock.calls[0][0].knownDirection).toBeUndefined();
  });

  it("refuses anything but IN or OUT, and records nothing", async () => {
    for (const Direction of ["in", "UNKNOWN", "ENTER", 1]) {
      const res = await post({ ...base, Direction });
      expect(res.status).toBe(400);
    }
    expect(recordScanEvent).not.toHaveBeenCalled();
  });
});
