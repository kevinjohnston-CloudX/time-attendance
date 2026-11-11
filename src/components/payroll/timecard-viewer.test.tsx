// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useNavigationTarget: () => null }));
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
            user: { name: "Test Person" }, department: { name: "Vas" }, employeeCode: "T1", wmsId: "605247", payRate: 15, payType: "HOURLY", startedOn: "2020-01-01", shift: null,
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

// Bergen's supervisors, 11/05: HR wanted them to correct missed punches and
// make no other change to a timecard. 11/10: on rows of regular hours only,
// with meal waivers but not meal premium waivers, and no Add time.
describe("a supervisor allowed only to fix missed punches", () => {
  const punch = (id: string, punchType: string, roundedTime: string, payCodeId: string | null = null) => ({ id, punchType, roundedTime, source: "TABLET", payCodeId });
  // Tuesday's shift, 8:00 AM to 4:30 PM Eastern, worked out.
  const tuesdayWork = { id: "w2", segmentType: "WORK", startTime: "2026-10-13T12:00:00.000Z", endTime: "2026-10-13T20:30:00.000Z", durationMinutes: 510, segmentDate: "2026-10-13T00:00:00.000Z", payBucket: "REGULAR", payBucketOverride: null, isPaid: true, payCode: null };
  function renderFixer(o: { mealConfig?: object; segments?: object[]; punches?: object[] } = {}) {
    render(
      <TimecardViewer
        payPeriods={[{ id: "p1", startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" }]}
        selectedPeriodId="p1"
        employees={[{ employeeId: "e1", name: "Test Person", employeeCode: "T1", wmsId: "605247", department: "Vas", siteId: "s1", siteName: "Site", isActive: true, payType: "HOURLY" }]}
        selectedEmployeeId="e1"
        timecard={{
          timesheetId: "t1", status: "OPEN", otAuthorized: false, exceptionCount: 1,
          // Clocked in Monday at 8:00 AM and never out; Tuesday is a whole shift.
          exceptions: [{ id: "x1", exceptionType: "MISSING_PUNCH", occurredAt: "2026-10-12T12:00:00.000Z" }],
          payPeriod: { startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" },
          employee: {
            user: { name: "Test Person" }, department: { name: "Vas" }, employeeCode: "T1", wmsId: "605247", payRate: 15, payType: "HOURLY", startedOn: "2020-01-01", shift: o.mealConfig ? { mealConfig: o.mealConfig } : null,
            ruleSet: { overtimeRequiresAuth: false, allowTimesheetOtAuth: false, defaultPayCodeId: null },
          },
          punches: (o.punches ?? [
            punch("i1", "CLOCK_IN", "2026-10-12T12:00:00.000Z"),
            punch("i2", "CLOCK_IN", "2026-10-13T12:00:00.000Z"),
            punch("o2", "CLOCK_OUT", "2026-10-13T20:30:00.000Z"),
          ]) as never,
          segments: (o.segments ?? []) as never, overtimeBuckets: [], mealWaivers: [], mealPremiumWaivers: [], notes: [], dayReasons: [],
        }}
        payFrequency="BIWEEKLY"
        payCodes={[{ id: "pc0", code: 0, label: "Regular hours" }]}
        reasonCodes={[{ id: "rc1", code: "1", label: "Forgot to punch" }] as never}
        sites={[]}
        selectedSiteId={null}
        departments={[]}
        selectedDepartmentId={null}
        userRole="SUPERVISOR"
        missedPunchesOnly
        siteTimezone="America/New_York"
      />,
    );
  }

  it("adds the missing clock out, and changes nothing else", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
    addManualPunches.mockClear();
    renderFixer();
    const row = (label: RegExp) => screen.getAllByRole("row").find((r) => label.test(r.textContent ?? ""))!;
    expect(screen.getByText("Missed punches only")).not.toBeNull();
    // Add time is HR's and payroll's.
    expect(screen.queryByRole("button", { name: "Add time" })).toBeNull();
    // Tuesday's punches are there to read, not to change.
    const tuesday = [...row(/Tue, Oct 13/).querySelectorAll("button")].filter((b) => /AM|PM/.test(b.textContent ?? ""));
    expect(tuesday.length).toBe(2);
    for (const b of tuesday) expect(b.hasAttribute("disabled")).toBe(true);
    // No reason code or pay code offered anywhere.
    expect([...document.querySelectorAll("tr select:not([disabled])")].length).toBe(0);
    // Times go on a day marked Absent, and no other empty day: not the
    // weekend, not today.
    const dash = (label: RegExp) => [...row(label).querySelectorAll("button")].filter((b) => b.textContent === "—").length;
    expect(dash(/Wed, Oct 14/)).toBe(2);
    expect(dash(/Sun, Oct 11/)).toBe(0);
    expect(dash(/Thu, Oct 15/)).toBe(0);

    fireEvent.click([...row(/Mon, Oct 12/).querySelectorAll("button")].find((b) => b.textContent === "Missing")!);
    const input = row(/Mon, Oct 12/).querySelector("input")!;
    fireEvent.change(input, { target: { value: "4:30" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText("Save changes"));
    await vi.waitFor(() => expect(addManualPunches).toHaveBeenCalledTimes(1));
    const [{ punches }] = addManualPunches.mock.calls[0] as unknown as [{ punches: { punchType: string }[] }];
    expect(punches.map((p) => p.punchType)).toEqual(["CLOCK_OUT"]);
    vi.useRealTimers();
  });

  it("puts one shift on a day marked Absent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
    addManualPunches.mockClear();
    renderFixer();
    const wednesday = () => screen.getAllByRole("row").find((r) => /Wed, Oct 14/.test(r.textContent ?? ""))!;
    const type = (nth: number, value: string) => {
      fireEvent.click([...wednesday().querySelectorAll("button")].filter((b) => b.textContent === "—")[nth]!);
      const input = wednesday().querySelector("input")!;
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    };
    type(0, "8:00");
    type(0, "4:30");
    fireEvent.click(screen.getByText("Save changes"));
    await vi.waitFor(() => expect(addManualPunches).toHaveBeenCalledTimes(1));
    const [{ punches }] = addManualPunches.mock.calls[0] as unknown as [{ punches: { punchType: string; punchTime: string }[] }];
    // 8:00 AM to 4:30 PM Eastern.
    expect(punches).toEqual([
      { punchType: "CLOCK_IN", punchTime: "2026-10-14T12:00:00.000Z" },
      { punchType: "CLOCK_OUT", punchTime: "2026-10-14T20:30:00.000Z" },
    ]);
    vi.useRealTimers();
  });

  it("adds no missing clock out to a shift on another pay code", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
    renderFixer({ punches: [punch("i1", "CLOCK_IN", "2026-10-12T12:00:00.000Z", "pcOt")] });
    const monday = screen.getAllByRole("row").find((r) => /Mon, Oct 12/.test(r.textContent ?? ""))!;
    expect(monday.textContent).toMatch(/Missing/);
    expect([...monday.querySelectorAll("button")].some((b) => b.textContent === "Missing")).toBe(false);
    vi.useRealTimers();
  });

  it("waives the meal deducted on a day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
    const { toggleMealWaiver } = await import("@/actions/timesheet.actions");
    (toggleMealWaiver as unknown as { mockClear: () => void }).mockClear();
    renderFixer({ mealConfig: { autoDeduct: true, meals: [{ workAtLeastHours: 6, deductMinutes: 30 }] }, segments: [tuesdayWork] });
    const tuesday = () => screen.getAllByRole("row").find((r) => /Tue, Oct 13/.test(r.textContent ?? ""))!;
    fireEvent.click([...tuesday().querySelectorAll("button")].find((b) => b.textContent === "Waive")!);
    fireEvent.click(screen.getByText("Save changes"));
    await vi.waitFor(() => expect(toggleMealWaiver).toHaveBeenCalledWith({ timesheetId: "t1", segmentDate: "2026-10-13" }));
    vi.useRealTimers();
  });

  it("can't waive a meal premium", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
    const premium = { ...tuesdayWork, id: "mp2", segmentType: "MEAL_PREMIUM", startTime: "2026-10-13T20:30:00.000Z", endTime: "2026-10-13T21:30:00.000Z", durationMinutes: 60, payCode: { id: "pcMp", code: 20, label: "Meal premium" } };
    renderFixer({ segments: [tuesdayWork, premium] });
    expect(screen.getAllByText(/Meal premium/).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Waive/ }).length).toBe(0);
    vi.useRealTimers();
  });

  it("shows hours entered with Add time without clock times, and no meal to waive", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
    // 8 hours entered on Tuesday: kept from 12:00 AM to 8:00 AM Eastern.
    const entered = { ...punch("h1", "CLOCK_IN", "2026-10-13T04:00:00.000Z", "pcFmla"), hoursOnly: true };
    const enteredOut = { ...punch("h2", "CLOCK_OUT", "2026-10-13T12:00:00.000Z"), hoursOnly: true };
    renderFixer({ punches: [entered, enteredOut], mealConfig: { autoDeduct: true, meals: [{ workAtLeastHours: 6, deductMinutes: 30 }] }, segments: [{ ...tuesdayWork, startTime: entered.roundedTime, endTime: enteredOut.roundedTime, durationMinutes: 480 }] });
    const tuesday = screen.getAllByRole("row").find((r) => /Tue, Oct 13/.test(r.textContent ?? ""))!;
    expect(tuesday.textContent).not.toMatch(/12:00 AM|8:00 AM/);
    expect([...tuesday.querySelectorAll("button")].some((b) => /Waive/.test(b.textContent ?? ""))).toBe(false);
    vi.useRealTimers();
  });

  it("adds a note of their own to a day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
    renderFixer();
    const monday = screen.getAllByRole("row").find((r) => /Mon, Oct 12/.test(r.textContent ?? ""))!;
    fireEvent.click(monday.querySelector("button[title=\"Add note\"]")!);
    fireEvent.change(screen.getByLabelText("New note"), { target: { value: "Forgot to clock out, confirmed with lead" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Notes" })).getByRole("button", { name: "Add note" }));
    const { saveTimesheetNote } = await import("@/actions/timecard-entry.actions");
    await vi.waitFor(() => expect(saveTimesheetNote).toHaveBeenCalledWith({ timesheetId: "t1", noteDate: "2026-10-12", note: "Forgot to clock out, confirmed with lead" }));
    vi.useRealTimers();
  });
});

// Hired 10/19, in a period that began 10/11: the weekdays before were marked
// Absent on the timecard though no absence was ever recorded for them.
describe("someone who started partway through the period", () => {
  it("marks no day before the start date Absent, and the days from it as usual", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T16:00:00Z"));
    const employee = { employeeId: "e1", name: "Test Person", employeeCode: "T1", wmsId: "115229", department: "Vas", siteId: "s1", siteName: "Site", isActive: true, payType: "HOURLY", startedOn: "2026-10-19" };
    render(
      <TimecardViewer
        payPeriods={[{ id: "p1", startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" }]}
        selectedPeriodId="p1"
        employees={[employee]}
        selectedEmployeeId="e1"
        timecard={{
          timesheetId: "t1", status: "OPEN", otAuthorized: false, exceptionCount: 0, exceptions: [],
          payPeriod: { startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" },
          employee: {
            user: { name: "Test Person" }, department: { name: "Vas" }, employeeCode: "T1", wmsId: "115229", payRate: 15, payType: "HOURLY", startedOn: "2026-10-19", shift: null,
            ruleSet: { overtimeRequiresAuth: false, allowTimesheetOtAuth: false, defaultPayCodeId: null },
          },
          punches: [], segments: [], overtimeBuckets: [], mealWaivers: [], mealPremiumWaivers: [], notes: [], dayReasons: [],
        }}
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
    const row = (label: RegExp) => screen.getAllByRole("row").find((r) => label.test(r.textContent ?? ""))!;
    for (const day of [/Mon, Oct 12/, /Wed, Oct 14/, /Fri, Oct 16/]) expect(row(day).textContent).not.toContain("Absent");
    expect(row(/Mon, Oct 19/).textContent).toContain("Absent");
    vi.useRealTimers();
  });
});
