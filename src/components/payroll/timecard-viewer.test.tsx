// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { fn } = vi.hoisted(() => ({ fn: () => vi.fn(async () => ({ success: true, data: {} })) }));
vi.mock("@/actions/punch.actions", () => ({ correctPunch: fn(), deletePunch: fn() }));
vi.mock("@/actions/timesheet.actions", () => ({ toggleMealWaiver: fn(), toggleMealPremiumWaiver: fn(), authorizeTimecardOt: fn(), recalculateSegmentsAdmin: fn() }));
vi.mock("@/actions/timecard-entry.actions", () => ({ removePayrollLeaveEntry: fn(), getLeaveTypesForTimecard: vi.fn(async () => ({ success: true, data: [] })), saveTimesheetNote: fn(), addManualPunchPair: fn(), addSingleManualPunch: fn(), deleteManualPunchPair: fn(), addManualHoursEntry: fn() }));
vi.mock("@/actions/pay-code.actions", () => ({ setSegmentPayCode: fn(), setSegmentPayBucket: fn(), setAbsentDayPayBucket: fn(), setAbsentDayPayCode: fn() }));
vi.mock("@/actions/reason-code.actions", () => ({ setDayReasonCode: fn() }));
vi.mock("@/actions/timecard.actions", () => ({ ensureTimesheet: fn() }));
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
});
