// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { fn, addManualPunches, ensureTimesheet } = vi.hoisted(() => ({
  fn: () => vi.fn(async () => ({ success: true, data: {} })),
  addManualPunches: vi.fn(async () => ({ success: true, data: undefined })),
  ensureTimesheet: vi.fn(async () => ({ success: true, data: { timesheetId: "t1" } })),
}));
vi.mock("@/actions/punch.actions", () => ({ correctPunch: fn(), deletePunch: fn() }));
vi.mock("@/actions/timesheet.actions", () => ({ toggleMealWaiver: fn(), toggleMealPremiumWaiver: fn(), authorizeTimecardOt: fn(), recalculateSegmentsAdmin: fn() }));
vi.mock("@/actions/timecard-entry.actions", () => ({ removePayrollLeaveEntry: fn(), getLeaveTypesForTimecard: vi.fn(async () => ({ success: true, data: [] })), saveTimesheetNote: fn(), addManualPunchPair: fn(), addManualPunches, deleteManualPunchPair: fn(), addManualHoursEntry: fn() }));
vi.mock("@/actions/pay-code.actions", () => ({ setSegmentPayCode: fn(), setSegmentPayBucket: fn(), setAbsentDayPayBucket: fn(), setAbsentDayPayCode: fn() }));
vi.mock("@/actions/reason-code.actions", () => ({ setDayReasonCode: fn() }));
vi.mock("@/actions/timecard.actions", () => ({ ensureTimesheet }));
vi.mock("@/components/payroll/add-timecard-entry", () => ({ AddTimecardEntry: () => null }));
vi.mock("@/components/payroll/refused-scans-notice", () => ({ RefusedScansNotice: () => null }));
vi.mock("@/components/payroll/timecard-lock-control", () => ({ TimecardLockControl: () => null }));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/payroll/timecards" }));

import { TimecardViewer } from "./timecard-viewer";

afterEach(cleanup);

// Someone with no timecard in the period yet: the first time typed used to be
// dropped on leaving the box, because keeping it required a timecard (one is
// only made when the changes are saved).
describe("typing a first time for someone with no timecard", () => {
  it("keeps the In as a change to save when Out is clicked", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T16:00:00Z"));
    render(
      <TimecardViewer
        payPeriods={[{ id: "p1", startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" }]}
        selectedPeriodId="p1"
        employees={[{ employeeId: "e1", name: "Test Person", employeeCode: "T1", wmsId: "9999832", department: "It", siteId: "s1", siteName: "Site", isActive: true, payType: "HOURLY" }]}
        selectedEmployeeId="e1"
        timecard={null}
        payFrequency="BIWEEKLY"
        payCodes={[]}
        reasonCodes={[]}
        sites={[]}
        selectedSiteId={null}
        departments={[]}
        selectedDepartmentId={null}
        userRole="SYSTEM_ADMIN"
        siteTimezone="America/New_York"
      />,
    );
    const rows = screen.getAllByRole("row");
    const sun = rows.find((r) => /Sun, Oct 11/.test(r.textContent ?? ""))!;
    const dashes = sun.querySelectorAll("button");
    const inBtn = [...dashes].find((b) => b.textContent === "—")!;
    fireEvent.click(inBtn);
    const input = sun.querySelector("input")!;
    fireEvent.change(input, { target: { value: "7:00" } });
    const outBtn = [...sun.querySelectorAll("button")].find((b) => b.textContent === "—")!;
    fireEvent.blur(input);
    fireEvent.click(outBtn);
    const after = rows.find((r) => /Sun, Oct 11/.test(r.textContent ?? ""))!;
    expect(after.textContent).toContain("7:00 AM");
    expect(screen.queryByText("Save changes")).not.toBeNull();
    vi.useRealTimers();
  });

  // Saved one request each, the clock in's recalculation could run before the
  // clock out was in and leave a missed punch's 11:59 PM clock out behind
  // (Stephanie Resendiz, 10/19).
  it("saves the In and the Out typed on a day together, in one request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T16:00:00Z"));
    render(
      <TimecardViewer
        payPeriods={[{ id: "p1", startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" }]}
        selectedPeriodId="p1"
        employees={[{ employeeId: "e1", name: "Test Person", employeeCode: "T1", wmsId: "9999832", department: "It", siteId: "s1", siteName: "Site", isActive: true, payType: "HOURLY" }]}
        selectedEmployeeId="e1"
        timecard={null}
        payFrequency="BIWEEKLY"
        payCodes={[]}
        reasonCodes={[]}
        sites={[]}
        selectedSiteId={null}
        departments={[]}
        selectedDepartmentId={null}
        userRole="SYSTEM_ADMIN"
        siteTimezone="America/New_York"
      />,
    );
    const sun = () => screen.getAllByRole("row").find((r) => /Sun, Oct 11/.test(r.textContent ?? ""))!;
    const type = (value: string) => {
      fireEvent.click([...sun().querySelectorAll("button")].find((b) => b.textContent === "—")!);
      const input = sun().querySelector("input")!;
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    };
    type("7:00");
    type("11:00");
    fireEvent.click(screen.getByText("Save changes"));
    await vi.waitFor(() => expect(addManualPunches).toHaveBeenCalledTimes(1));
    const [{ punches }] = addManualPunches.mock.calls[0] as unknown as [{ punches: { punchType: string }[] }];
    expect(punches.map((p) => p.punchType)).toEqual(["CLOCK_IN", "CLOCK_OUT"]);
    vi.useRealTimers();
  });
});

// Ma Concepcion Plancarte Garcia's period: 8 hours worked on 10/12, and 8
// hours of Unpaid Time Off on 10/19 and on 10/20. The summary left the unpaid
// hours out, so it did not show every coded hour in the period.
describe("the summary of a period with unpaid leave", () => {
  it("lists the unpaid hours under their own code, in Total hours but never in pay", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T16:00:00Z"));
    const regular = { id: "pc0", code: 0, label: "Regular hours" };
    const uto = { id: "pc13", code: 13, label: "Unpaid time off" };
    const seg = (id: string, day: string, type: string, minutes: number, isPaid: boolean, payBucket: string, payCode: typeof regular) => ({
      id, segmentType: type, startTime: `${day}T11:00:00.000Z`, endTime: `${day}T19:00:00.000Z`, durationMinutes: minutes,
      segmentDate: `${day}T00:00:00.000Z`, payBucket, payBucketOverride: null, isPaid, payCode,
    });
    render(
      <TimecardViewer
        payPeriods={[{ id: "p1", startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" }]}
        selectedPeriodId="p1"
        employees={[{ employeeId: "e1", name: "Test Person", employeeCode: "T1", wmsId: "605247", department: "Vas", siteId: "s1", siteName: "Site", isActive: true, payType: "HOURLY" }]}
        selectedEmployeeId="e1"
        timecard={{
          timesheetId: "t1", status: "OPEN", otAuthorized: false, exceptionCount: 0, exceptions: [],
          payPeriod: { startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" },
          employee: {
            user: { name: "Test Person" }, department: { name: "Vas" }, employeeCode: "T1", wmsId: "605247", payRate: 15, payType: "HOURLY", shift: null,
            ruleSet: { overtimeRequiresAuth: false, allowTimesheetOtAuth: false, defaultPayCodeId: null },
          },
          punches: [],
          segments: [
            seg("w1", "2026-10-12", "WORK", 480, true, "REG", regular),
            seg("l1", "2026-10-19", "LEAVE", 480, false, "UNPAID", uto),
            seg("l2", "2026-10-20", "LEAVE", 480, false, "UNPAID", uto),
          ],
          overtimeBuckets: [], mealWaivers: [], mealPremiumWaivers: [], notes: [], dayReasons: [],
        }}
        payFrequency="BIWEEKLY"
        payCodes={[regular, uto]}
        reasonCodes={[]}
        sites={[]}
        selectedSiteId={null}
        departments={[]}
        selectedDepartmentId={null}
        userRole="SYSTEM_ADMIN"
        siteTimezone="America/New_York"
      />,
    );
    const rows = screen.getAllByRole("row");
    const cells = (label: RegExp) => [...rows.find((r) => r.querySelector("td") && label.test(r.querySelector("td")!.textContent ?? ""))!.querySelectorAll("td")].map((c) => c.textContent);
    expect(screen.getAllByText("Unpaid").length).toBeGreaterThan(0);
    // Label, Regular, Overtime, Double, Unpaid, Total hours, Rate, Regular pay, Overtime pay, Double pay, Total pay
    expect(cells(/^Unpaid time off/)).toEqual(["Unpaid time off (13)", "—", "—", "—", "16.00", "16.00", "$15.00", "—", "—", "—", "$0.00"]);
    expect(cells(/^Totals$/)).toEqual(["Totals", "8.00", "—", "—", "16.00", "24.00", "$15.00", "$120.00", "—", "—", "$120.00"]);
    vi.useRealTimers();
  });
});
