// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { fn, addManualPunches, ensureTimesheet, submitTimecardEdits, withdrawTimecardEdit, decideTimesheetEdits } = vi.hoisted(() => ({
  fn: () => vi.fn(async () => ({ success: true, data: {} })),
  addManualPunches: vi.fn(async () => ({ success: true, data: undefined })),
  ensureTimesheet: vi.fn(async () => ({ success: true, data: { timesheetId: "t1" } })),
  submitTimecardEdits: vi.fn(async () => ({ success: true, data: { requestId: "r9", timesheetId: "t1" } })),
  withdrawTimecardEdit: vi.fn(async () => ({ success: true, data: undefined })),
  decideTimesheetEdits: vi.fn(async () => ({ success: true, data: { approved: 1, rejected: 1, failed: [] } })),
}));
vi.mock("@/actions/timecard-edit.actions", () => ({ submitTimecardEdits, withdrawTimecardEdit, decideTimesheetEdits, reviseTimecardEdit: vi.fn(async () => ({ success: true, data: undefined })) }));
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

  // 11/12: HR enters FMLA as two lines on a day, the FMLA hours and the same
  // hours as Unpaid Time Off. Only the first showed until the day was opened,
  // and the summary paid the FMLA hours though FMLA is Not paid.
  it("shows both lines of an FMLA day, and pays neither", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T16:00:00Z"));
    const fmla = { id: "pc11", code: 11, label: "FMLA", isPaid: false };
    const uto = { id: "pc13", code: 13, label: "Unpaid time off" };
    const seg = (id: string, type: string, isPaid: boolean, payBucket: string, payCode: object) => ({
      id, segmentType: type, startTime: "2026-10-19T04:00:00.000Z", endTime: "2026-10-19T12:00:00.000Z", durationMinutes: 480,
      segmentDate: "2026-10-19T00:00:00.000Z", payBucket, payBucketOverride: null, isPaid, payCode,
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
            user: { name: "Test Person" }, department: { name: "Vas" }, employeeCode: "T1", wmsId: "605247", payRate: 22, payType: "HOURLY", startedOn: "2020-01-01", shift: null,
            ruleSet: { overtimeRequiresAuth: false, allowTimesheetOtAuth: false, defaultPayCodeId: null },
          },
          punches: [],
          segments: [
            seg("w1", "WORK", true, "REG", fmla),
            { ...seg("l1", "LEAVE", false, "UNPAID", uto), leaveRequest: { id: "lr1", leaveType: { name: "UnPaid Time Off", category: "UNPAID", payCode: uto } } },
          ] as never,
          overtimeBuckets: [], mealWaivers: [], mealPremiumWaivers: [], notes: [], dayReasons: [],
        }}
        payFrequency="BIWEEKLY"
        payCodes={[fmla, uto]}
        reasonCodes={[]}
        sites={[]}
        selectedSiteId={null}
        departments={[]}
        selectedDepartmentId={null}
        userRole="SYSTEM_ADMIN"
        siteTimezone="America/New_York"
      />,
    );
    // The Unpaid Time Off line shows under the FMLA day without opening it.
    expect(document.querySelectorAll("tr[data-row=\"leave\"]").length).toBe(1);
    const rows = screen.getAllByRole("row");
    const cells = (label: RegExp) => [...rows.find((r) => r.querySelector("td") && label.test(r.querySelector("td")!.textContent ?? ""))!.querySelectorAll("td")].map((c) => c.textContent);
    // FMLA is Not paid: under Unpaid, no pay, as the payroll file has it.
    expect(cells(/^FMLA/)).toEqual(["FMLA (11)", "—", "—", "—", "8.00", "8.00", "$22.00", "—", "—", "—", "$0.00"]);
    vi.useRealTimers();
  });
});

// Bergen's supervisors, 11/11: where the person's site lets supervisors edit
// timecards, they change rows of regular hours as HR does and Save sends the
// changes to HR for approval; elsewhere the timecard is read only to them.
// Each renders the whole timecard; under a full run some take over 5 seconds.
describe("a supervisor whose changes go to HR", { timeout: 20_000 }, () => {
  const punch = (id: string, punchType: string, roundedTime: string, payCodeId: string | null = null) => ({ id, punchType, roundedTime, source: "TABLET", payCodeId });
  // Tuesday's shift, 8:00 AM to 4:30 PM Eastern, worked out.
  const tuesdayWork = { id: "w2", segmentType: "WORK", startTime: "2026-10-13T12:00:00.000Z", endTime: "2026-10-13T20:30:00.000Z", durationMinutes: 510, segmentDate: "2026-10-13T00:00:00.000Z", payBucket: "REGULAR", payBucketOverride: null, isPaid: true, payCode: null };
  const waiting = (items: object[], status = "PENDING") => [{ id: "r1", status, submittedBy: "Flavio Morales", createdAt: "2026-10-15T14:00:00.000Z", reason: "Forgot to punch", decisionNote: null, items }];
  const item = (id: string, extra: object) => ({ id, status: "PENDING", error: null, punchId: null, punchType: null, at: null, endAt: null, minutes: null, waive: null, ...extra });
  function renderSup(o: { mealConfig?: object; segments?: object[]; punches?: object[]; editRequests?: object[]; off?: boolean; hr?: boolean; premiums?: boolean; timecard?: null; period?: string } = {}) {
    render(
      <TimecardViewer
        payPeriods={[{ id: "p1", startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: o.period ?? "OPEN" }]}
        selectedPeriodId="p1"
        employees={[{ employeeId: "e1", name: "Test Person", employeeCode: "T1", wmsId: "605247", department: "Vas", siteId: "s1", siteName: "Site", isActive: true, payType: "HOURLY" }]}
        selectedEmployeeId="e1"
        timecard={o.timecard === null ? null : {
          timesheetId: "t1", status: "OPEN", otAuthorized: false, exceptionCount: 1,
          // Sunday a shift HR put on overtime; Monday clocked in at 8:00 AM
          // and never out; Tuesday a whole shift of regular hours.
          exceptions: [{ id: "x1", exceptionType: "MISSING_PUNCH", occurredAt: "2026-10-12T12:00:00.000Z" }],
          payPeriod: { startDate: "2026-10-11T00:00:00.000Z", endDate: "2026-10-25T00:00:00.000Z", status: "OPEN" },
          employee: {
            user: { name: "Test Person" }, department: { name: "Vas" }, employeeCode: "T1", wmsId: "605247", payRate: 15, payType: "HOURLY", startedOn: "2020-01-01", shift: o.mealConfig ? { mealConfig: o.mealConfig } : null,
            ruleSet: { overtimeRequiresAuth: false, allowTimesheetOtAuth: false, defaultPayCodeId: null },
          },
          punches: (o.punches ?? [
            punch("i0", "CLOCK_IN", "2026-10-11T12:00:00.000Z", "pcOt"),
            punch("o0", "CLOCK_OUT", "2026-10-11T16:00:00.000Z"),
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
        userRole={o.hr ? "HR_ADMIN" : "SUPERVISOR"}
        readOnly={!o.hr && !!o.off}
        sendsForApproval={!o.hr && !o.off}
        supervisorEditsOff={!o.hr && !!o.off}
        waivesMealPremiums={o.premiums ?? true}
        editRequests={(o.editRequests ?? []) as never}
        siteTimezone="America/New_York"
      />,
    );
  }
  const row = (label: RegExp) => screen.getAllByRole("row").find((r) => label.test(r.textContent ?? ""))!;
  const times = (label: RegExp) => [...row(label).querySelectorAll("button")].filter((b) => /AM|PM/.test(b.textContent ?? ""));
  const at = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };
  afterEach(() => { vi.useRealTimers(); });

  it("is read only where the person's site has supervisor edits off", () => {
    at("2026-10-15T16:00:00Z");
    renderSup({ off: true });
    expect(screen.getByText("Read only")).not.toBeNull();
    expect([...row(/Mon, Oct 12/).querySelectorAll("button")].some((b) => b.textContent === "Missing")).toBe(false);
    for (const b of times(/Tue, Oct 13/)) expect(b.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Add time" })).toBeNull();
  });

  it("sends a changed time and the missing clock out to HR together, and applies nothing", async () => {
    at("2026-10-15T16:00:00Z");
    submitTimecardEdits.mockClear();
    addManualPunches.mockClear();
    const { correctPunch } = await import("@/actions/punch.actions");
    (correctPunch as unknown as { mockClear: () => void }).mockClear();
    renderSup();
    expect(screen.getByText("Your edits need approval")).not.toBeNull();
    // No reason code or pay code offered anywhere.
    expect([...document.querySelectorAll("tr select:not([disabled])")].length).toBe(0);
    const type = (button: HTMLElement, value: string) => {
      const tr = button.closest("tr")!;
      fireEvent.click(button);
      const input = tr.querySelector("input")!;
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    };
    type(times(/Tue, Oct 13/).find((b) => b.textContent === "8:00 AM")!, "7:59");
    type([...row(/Mon, Oct 12/).querySelectorAll("button")].find((b) => b.textContent === "Missing")!, "4:30");
    fireEvent.change(screen.getByLabelText("Reason for the changed or removed punches"), { target: { value: "Forgot to punch" } });
    fireEvent.click(screen.getByText("Save changes"));
    await vi.waitFor(() => expect(submitTimecardEdits).toHaveBeenCalledTimes(1));
    expect(submitTimecardEdits).toHaveBeenCalledWith({
      employeeId: "e1",
      periodId: "p1",
      reason: "Forgot to punch",
      items: [
        { kind: "CHANGE_PUNCH", punchId: "i2", at: "2026-10-13T11:59:00.000Z" },
        { kind: "ADD_PUNCH", punchType: "CLOCK_OUT", at: "2026-10-12T20:30:00.000Z" },
      ],
    });
    expect(correctPunch).not.toHaveBeenCalled();
    expect(addManualPunches).not.toHaveBeenCalled();
  });

  it("changes nothing on a row HR put on another pay code", () => {
    at("2026-10-15T16:00:00Z");
    renderSup();
    for (const b of times(/Sun, Oct 11/)) expect(b.hasAttribute("disabled")).toBe(true);
    for (const b of times(/Tue, Oct 13/)) expect(b.hasAttribute("disabled")).toBe(false);
  });

  // 11/11: hours on another code with no punches (Salary, PTO) left the day
  // open to a supervisor's punches; it is that code's day.
  it("adds nothing to a day with hours on another pay code", () => {
    at("2026-10-15T16:00:00Z");
    const pto = { ...tuesdayWork, id: "l4", segmentType: "LEAVE", startTime: "2026-10-14T12:00:00.000Z", endTime: "2026-10-14T20:00:00.000Z", durationMinutes: 480, segmentDate: "2026-10-14T00:00:00.000Z", payCode: { id: "pcPto", code: 5, label: "PTO" } };
    renderSup({ segments: [pto] });
    expect([...row(/Wed, Oct 14/).querySelectorAll("button")].some((b) => b.textContent === "—")).toBe(false);
  });

  it("shows what waits for HR on its day, and takes it back", async () => {
    at("2026-10-15T16:00:00Z");
    withdrawTimecardEdit.mockClear();
    renderSup({ editRequests: waiting([item("a1", { kind: "ADD_PUNCH", punchType: "CLOCK_OUT", at: "2026-10-12T20:30:00.000Z", day: "2026-10-12", text: "Add clock out 4:30 PM" })]) });
    expect(row(/Mon, Oct 12/).textContent).toMatch(/Waiting for approval/);
    expect(times(/Mon, Oct 12/).map((b) => b.textContent)).toContain("4:30 PM");
    // One line until opened.
    expect(screen.getByText("1 change waiting for approval from Flavio Morales.")).not.toBeNull();
    expect(screen.queryByText(/Mon, Oct 12: Add clock out 4:30 PM/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText(/Mon, Oct 12: Add clock out 4:30 PM/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take back" }));
    await vi.waitFor(() => expect(withdrawTimecardEdit).toHaveBeenCalledWith({ itemId: "a1" }));
  });

  it("lets HR approve, or turn some down with a note", async () => {
    at("2026-10-15T16:00:00Z");
    decideTimesheetEdits.mockClear();
    renderSup({
      hr: true,
      editRequests: waiting([
        item("a1", { kind: "ADD_PUNCH", punchType: "CLOCK_OUT", at: "2026-10-12T20:30:00.000Z", day: "2026-10-12", text: "Add clock out 4:30 PM" }),
        item("a2", { kind: "CHANGE_PUNCH", punchId: "i2", punchType: "CLOCK_IN", at: "2026-10-13T11:59:00.000Z", day: "2026-10-13", text: "Change clock in 8:00 AM to 7:59 AM" }),
      ]),
    });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByLabelText(/Tue, Oct 13: Change clock in/));
    fireEvent.click(screen.getByRole("button", { name: "Approve 1, turn down 1" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Say why/);
    expect(decideTimesheetEdits).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Why the changes are turned down"), { target: { value: "She clocked in at 8:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve 1, turn down 1" }));
    await vi.waitFor(() => expect(decideTimesheetEdits).toHaveBeenCalledWith(expect.objectContaining({ timesheetId: "t1", rejectItemIds: ["a2"], note: "She clocked in at 8:00" })));
  });

  it("sends Add time to HR as regular hours", async () => {
    at("2026-10-15T16:00:00Z");
    submitTimecardEdits.mockClear();
    renderSup();
    fireEvent.click(screen.getByRole("button", { name: "Add time" }));
    const date = document.querySelector("form input[type=date]") as HTMLInputElement;
    expect(date.value).toBe("2026-10-15");
    expect(date.max).toBe("2026-10-15");
    const dialog = date.closest("form")!;
    const selects = [...dialog.querySelectorAll("select")].filter((el) => !/AM or PM/.test(el.getAttribute("aria-label") ?? ""));
    // One pay code, regular hours, and no Reason.
    expect(selects.length).toBe(1);
    expect(selects[0].disabled).toBe(true);
    fireEvent.change(dialog.querySelector("input[placeholder=\"8:00\"]")!, { target: { value: "8:00" } });
    fireEvent.change(dialog.querySelector("input[placeholder=\"5:00\"]")!, { target: { value: "4:30" } });
    fireEvent.submit(dialog);
    await vi.waitFor(() => expect(submitTimecardEdits).toHaveBeenCalledTimes(1));
    expect(submitTimecardEdits).toHaveBeenCalledWith({
      employeeId: "e1", periodId: "p1", reason: "Added with Add time",
      items: [{ kind: "ADD_PAIR", day: "2026-10-15", at: "2026-10-15T12:00:00.000Z", endAt: "2026-10-15T20:30:00.000Z" }],
    });
  });

  it("sends a meal waiver, and can't waive a meal premium", async () => {
    at("2026-10-15T16:00:00Z");
    submitTimecardEdits.mockClear();
    renderSup({ mealConfig: { autoDeduct: true, meals: [{ workAtLeastHours: 6, deductMinutes: 30 }] }, segments: [tuesdayWork] });
    fireEvent.click([...row(/Tue, Oct 13/).querySelectorAll("button")].find((b) => b.textContent === "Waive")!);
    fireEvent.change(screen.getByLabelText("Reason for the changed or removed punches"), { target: { value: "Worked through lunch" } });
    fireEvent.click(screen.getByText("Save changes"));
    await vi.waitFor(() => expect(submitTimecardEdits).toHaveBeenCalledWith(expect.objectContaining({ items: [{ kind: "MEAL_WAIVER", day: "2026-10-13", waive: true }] })));
    cleanup();
    const premium = { ...tuesdayWork, id: "mp2", segmentType: "MEAL_PREMIUM", startTime: "2026-10-13T20:30:00.000Z", endTime: "2026-10-13T21:30:00.000Z", durationMinutes: 60, payCode: { id: "pcMp", code: 20, label: "Meal premium" } };
    renderSup({ segments: [tuesdayWork, premium] });
    expect(screen.getAllByText(/Meal premium/).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Waive/ }).length).toBe(0);
  });

  // 11/16: a Manager changes their people's timecards directly, but a CA meal premium stays HR's.
  it("offers Waive on a meal premium to HR and payroll, not to a Manager", () => {
    at("2026-10-15T16:00:00Z");
    const premium = { ...tuesdayWork, id: "mp2", segmentType: "MEAL_PREMIUM", startTime: "2026-10-13T20:30:00.000Z", endTime: "2026-10-13T21:30:00.000Z", durationMinutes: 60, payCode: { id: "pcMp", code: 20, label: "Meal premium" } };
    renderSup({ hr: true, segments: [tuesdayWork, premium] });
    expect(screen.queryAllByRole("button", { name: /^Waive/ }).length).toBe(1);
    cleanup();
    renderSup({ hr: true, premiums: false, segments: [tuesdayWork, premium] });
    expect(screen.getAllByText(/Meal premium/).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Waive/ }).length).toBe(0);
  });

  it("shows hours entered with Add time without clock times, and no meal to waive", () => {
    at("2026-10-15T16:00:00Z");
    // 8 hours entered on Tuesday: kept from 12:00 AM to 8:00 AM Eastern.
    const entered = { ...punch("h1", "CLOCK_IN", "2026-10-13T04:00:00.000Z", "pcFmla"), hoursOnly: true };
    const enteredOut = { ...punch("h2", "CLOCK_OUT", "2026-10-13T12:00:00.000Z"), hoursOnly: true };
    renderSup({ punches: [entered, enteredOut], mealConfig: { autoDeduct: true, meals: [{ workAtLeastHours: 6, deductMinutes: 30 }] }, segments: [{ ...tuesdayWork, startTime: entered.roundedTime, endTime: enteredOut.roundedTime, durationMinutes: 480 }] });
    const tuesday = row(/Tue, Oct 13/);
    expect(tuesday.textContent).not.toMatch(/12:00 AM|8:00 AM/);
    expect([...tuesday.querySelectorAll("button")].some((b) => /Waive/.test(b.textContent ?? ""))).toBe(false);
  });

  // Someone with no timecard yet was Read only to a supervisor (Mario Robles):
  // the first change sent makes the timecard.
  it("sends an Absent day for someone with no timecard yet, in an open period", async () => {
    at("2026-10-15T16:00:00Z");
    submitTimecardEdits.mockClear();
    ensureTimesheet.mockClear();
    const closed = render(<div />);
    closed.unmount();
    renderSup({ timecard: null, period: "LOCKED" });
    expect(screen.getByText("Read only")).not.toBeNull();
    cleanup();
    renderSup({ timecard: null });
    expect(screen.getByText("Your edits need approval")).not.toBeNull();
    const wednesday = () => row(/Wed, Oct 14/);
    const type = (value: string) => {
      fireEvent.click([...wednesday().querySelectorAll("button")].filter((b) => b.textContent === "—")[0]!);
      const input = wednesday().querySelector("input")!;
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    };
    type("8:00");
    type("4:30");
    fireEvent.change(screen.getByLabelText("Reason for the changed or removed punches"), { target: { value: "Worked, badge not read" } });
    fireEvent.click(screen.getByText("Save changes"));
    await vi.waitFor(() => expect(submitTimecardEdits).toHaveBeenCalledTimes(1));
    expect(ensureTimesheet).not.toHaveBeenCalled();
    expect(submitTimecardEdits).toHaveBeenCalledWith(expect.objectContaining({
      items: [
        { kind: "ADD_PUNCH", punchType: "CLOCK_IN", at: "2026-10-14T12:00:00.000Z" },
        { kind: "ADD_PUNCH", punchType: "CLOCK_OUT", at: "2026-10-14T20:30:00.000Z" },
      ],
    }));
  });

  it("adds a note of their own to a day", async () => {
    at("2026-10-15T16:00:00Z");
    renderSup();
    fireEvent.click(row(/Mon, Oct 12/).querySelector("button[title=\"Add note\"]")!);
    fireEvent.change(screen.getByLabelText("New note"), { target: { value: "Forgot to clock out, confirmed with lead" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Notes" })).getByRole("button", { name: "Add note" }));
    const { saveTimesheetNote } = await import("@/actions/timecard-entry.actions");
    await vi.waitFor(() => expect(saveTimesheetNote).toHaveBeenCalledWith({ timesheetId: "t1", noteDate: "2026-10-12", note: "Forgot to clock out, confirmed with lead" }));
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
