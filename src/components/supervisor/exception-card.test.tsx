// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { addAbsentDayPunches, addMissingPunchForEmployee } = vi.hoisted(() => ({
  addAbsentDayPunches: vi.fn(async () => ({ success: true, data: undefined })),
  addMissingPunchForEmployee: vi.fn(async () => ({ success: true, data: undefined })),
}));
vi.mock("@/actions/supervisor.actions", () => ({
  addAbsentDayPunches,
  addMissingPunchForEmployee,
  correctPunchAndResolve: vi.fn(),
  getExceptionPunches: vi.fn(async () => ({ success: true, data: [] })),
  resolveException: vi.fn(),
}));
vi.mock("@/actions/punch.actions", () => ({ approveMissedPunch: vi.fn(), rejectMissedPunch: vi.fn() }));

import { ExceptionCard } from "./exception-card";
import type { ExceptionRow } from "./exceptions-screen";

afterEach(cleanup);

// Thursday 11/05, Eastern (standard time: 8:00 AM is 13:00 UTC), marked Absent.
const row: ExceptionRow = {
  id: "x1", exceptionType: "ABSENT", description: "Absent", occurredAt: new Date("2026-11-05T12:00:00.000Z"), zone: "America/New_York",
  timesheetId: "t1", employeeId: "e1", employeeName: "Test Person", siteName: null, departmentName: null,
  payPeriod: { id: "p1", label: "Nov 1 to Nov 14, 2026" }, hasPunches: false,
  scheduled: { start: null, end: null }, recorded: { in: null, out: null }, requested: null,
};

async function fill(inTime: string, outTime: string, flip: string[] = []) {
  render(<ExceptionCard row={row} typeLabel="Absent" severity={1} reasonCodes={[{ id: "rc1", code: "1", label: "Forgot to punch" }]} onDone={() => {}} />);
  fireEvent.click(screen.getByText("Add Punches"));
  await screen.findByLabelText("Clock In");
  fireEvent.change(screen.getByLabelText("Clock In"), { target: { value: inTime } });
  fireEvent.change(screen.getByLabelText("Clock Out"), { target: { value: outTime } });
  for (const label of flip) fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByText("Save and Resolve"));
}

// 11/11: a supervisor who fixes missed punches only was refused here, as the
// clock in went alone and their rule fills an Absent day with a whole shift.
describe("filling a day marked Absent from the Exceptions page", () => {
  it("saves the clock in and the clock out in one request", async () => {
    addAbsentDayPunches.mockClear();
    addMissingPunchForEmployee.mockClear();
    await fill("8:00", "4:30");
    await vi.waitFor(() => expect(addAbsentDayPunches).toHaveBeenCalledTimes(1));
    expect(addAbsentDayPunches).toHaveBeenCalledWith({
      timesheetId: "t1", exceptionId: "x1", reason: "1: Forgot to punch",
      inTime: "2026-11-05T13:00:00.000Z", outTime: "2026-11-05T21:30:00.000Z",
    });
    expect(addMissingPunchForEmployee).not.toHaveBeenCalled();
  });

  it("puts a clock out earlier than the clock in after midnight", async () => {
    addAbsentDayPunches.mockClear();
    await fill("10:00", "6:30", ["Clock In is AM", "Clock Out is PM"]);
    await vi.waitFor(() => expect(addAbsentDayPunches).toHaveBeenCalledTimes(1));
    expect(addAbsentDayPunches).toHaveBeenCalledWith(expect.objectContaining({
      inTime: "2026-11-06T03:00:00.000Z", outTime: "2026-11-06T11:30:00.000Z",
    }));
  });
});
