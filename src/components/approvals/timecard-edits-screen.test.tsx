// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { push, refresh, decideTimesheetEdits, withdrawTimecardEdit } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  decideTimesheetEdits: vi.fn(async () => ({ success: true, data: { approved: 2, rejected: 0, failed: [] } })),
  withdrawTimecardEdit: vi.fn(async () => ({ success: true, data: undefined })),
}));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }), useNavigationTarget: () => null }));
vi.mock("@/actions/timecard-edit.actions", () => ({ decideTimesheetEdits, withdrawTimecardEdit }));

import { TimecardEditsScreen } from "./timecard-edits-screen";

afterEach(cleanup);

// One card per person and pay period, however many Saves (John, 11/12).
const timecards = [
  { timesheetId: "t1", employeeId: "e1", employeeName: "Heliana Salazar", employeeCode: "606732", siteName: "7575 Georgia", departmentName: "Account Management", periodId: "p1", periodLabel: "Nov 8 – Nov 21", senders: ["Flavio Morales"], oldestAt: "2026-11-11T14:00:00.000Z", count: 3, days: ["Tue, Nov 10", "Wed, Nov 11"] },
  { timesheetId: "t2", employeeId: "e2", employeeName: "Olga Thompson", employeeCode: "612345", siteName: "7575 Georgia", departmentName: "Inventory", periodId: "p1", periodLabel: "Nov 8 – Nov 21", senders: ["Flavio Morales"], oldestAt: "2026-11-11T15:00:00.000Z", count: 1, days: ["Mon, Nov 9"] },
];
const change = (id: string, text: string, reason: string) => ({ id, text, reason, sender: "Flavio Morales", sentAt: "2026-11-11T14:00:00.000Z" });
const preview = {
  timesheetId: "t1",
  items: [{ id: "a", updatedAt: "x" }, { id: "b", updatedAt: "x" }, { id: "c", updatedAt: "x" }],
  senders: ["Flavio Morales"],
  employee: { id: "e1", name: "Heliana Salazar", code: "606732", site: "7575 Georgia", department: "Account Management" },
  periodId: "p1",
  periodLabel: "Nov 8 – Nov 21",
  days: [
    { day: "2026-11-09", label: "Mon, Nov 9", pairs: [{ in: { id: "p1", type: "CLOCK_IN", time: "8:04 AM", at: 1 }, out: { id: "p2", type: "CLOCK_OUT", time: "2:09 PM", at: 2 } }], reg: 365, ot: 0, dt: 0, total: 365, codes: ["REGULAR HOURS"], items: [] },
    { day: "2026-11-10", label: "Tue, Nov 10", pairs: [
      { in: { id: "p3", type: "CLOCK_IN", time: "8:03 AM", at: 3 }, out: { id: "p4", type: "CLOCK_OUT", time: "2:11 PM", at: 4, waiting: "change", was: "3:11 PM" } },
      { in: { id: "p5", type: "CLOCK_IN", time: "3:11 PM", at: 5, waiting: "change", was: "5:16 PM" }, out: null },
    ], reg: 0, ot: 0, dt: 0, total: 0, codes: [], items: [change("a", "Change clock out 3:11 PM to 2:11 PM", "Missed the lunch clock out"), change("b", "Change clock in 5:16 PM to 3:11 PM", "Missed the lunch clock out")] },
    { day: "2026-11-11", label: "Wed, Nov 11", pairs: [{ in: { id: "p6", type: "CLOCK_IN", time: "7:58 AM", at: 6, waiting: "add" }, out: null }], reg: 0, ot: 0, dt: 0, total: 0, codes: [], items: [change("c", "Add clock in 7:58 AM", "Badge didn't read")] },
  ],
};

describe("timecard edits on Approvals", () => {
  it("lists one card a timecard, and shows the one picked as the timecard is laid out", () => {
    render(<TimecardEditsScreen requests={timecards} selectedId="t1" preview={preview as never} mode="decide" />);
    expect(screen.getAllByText("3 changes").length).toBe(2); // on its card, and over the timecard
    // The pay period on the card; its days are highlighted on the timecard.
    expect(screen.getAllByText("Pay period Nov 8 – Nov 21").length).toBe(2);
    expect(screen.getByRole("columnheader", { name: "Clock in" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Comment" })).not.toBeNull();
    expect(screen.getByTitle("Changed from 3:11 PM, waiting for approval").textContent).toBe("2:11 PM");
    // A second shift that day on a row of its own.
    expect(screen.getAllByText("↳").length).toBe(1);
    // Each change beside the reason its Save gave.
    expect(screen.getByText("“Badge didn't read”")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open timecard" }).getAttribute("href")).toBe("/payroll/timecards?employeeId=e1&periodId=p1");
    fireEvent.click(screen.getByText("Olga Thompson"));
    expect(push).toHaveBeenCalledWith("/approvals?view=timecards&timesheet=t2");
  });

  it("narrows the list by name or ID, and clears back", () => {
    render(<TimecardEditsScreen requests={timecards} selectedId="t1" preview={preview as never} mode="decide" />);
    expect(screen.getByText("2 timecards")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Employee name or ID"), { target: { value: "6123" } });
    expect(screen.getByText("1 timecard")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Employee name or ID"), { target: { value: "nobody" } });
    expect(screen.getByText("No matching timecards")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear all" })[0]);
    expect(screen.getByText("2 timecards")).not.toBeNull();
  });

  it("lets HR decide every change on the timecard at once, unticking any to turn down", async () => {
    decideTimesheetEdits.mockClear();
    render(<TimecardEditsScreen requests={timecards} selectedId="t1" preview={preview as never} mode="decide" />);
    fireEvent.click(screen.getByLabelText("Change clock in 5:16 PM to 3:11 PM"));
    fireEvent.change(screen.getByLabelText("Why the changes are turned down"), { target: { value: "She was at lunch until 3:11" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve 2, turn down 1" }));
    await vi.waitFor(() => expect(decideTimesheetEdits).toHaveBeenCalledWith(expect.objectContaining({ timesheetId: "t1", rejectItemIds: ["b"], note: "She was at lunch until 3:11" })));
    expect(refresh).toHaveBeenCalled();
  });

  it("lets a supervisor take a change back, and says when nothing waits", async () => {
    withdrawTimecardEdit.mockClear();
    render(<TimecardEditsScreen requests={timecards} selectedId="t1" preview={preview as never} mode="send" />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Take back" })[0]);
    await vi.waitFor(() => expect(withdrawTimecardEdit).toHaveBeenCalledWith({ itemId: "a" }));
    cleanup();
    render(<TimecardEditsScreen requests={[]} selectedId={null} preview={null} mode="decide" />);
    expect(screen.getByText("No timecard edits waiting")).not.toBeNull();
  });
});
