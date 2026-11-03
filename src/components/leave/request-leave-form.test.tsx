// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/actions/leave.actions", () => ({ createLeaveRequest: vi.fn(), submitLeaveRequest: vi.fn() }));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./leave-day-picker", () => ({ LeaveDayPicker: () => null }));

import { RequestLeaveForm } from "./request-leave-form";

afterEach(cleanup);

const types = [
  { id: "pto", name: "PTO" },
  { id: "sick", name: "Sick Leave", noNote: true },
];

describe("RequestLeaveForm, note on sick leave", () => {
  it("keeps the note box for leave that takes a note, as today", () => {
    render(<RequestLeaveForm leaveTypes={types} shift={null} />);
    expect(screen.getByLabelText("Note")).toBeTruthy();
    expect(screen.queryByText(/Do not share medical details/)).toBeNull();
  });

  it("shows no note box, only the hint, for a type that takes no note", () => {
    render(<RequestLeaveForm leaveTypes={types} shift={null} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "sick" } });
    expect(screen.queryByLabelText("Note")).toBeNull();
    expect(screen.getByText("Do not share medical details. Only the dates are needed.")).toBeTruthy();
  });

  it("is unchanged for a company that never switched it on (no type carries noNote)", () => {
    render(<RequestLeaveForm leaveTypes={[{ id: "sick", name: "Sick Leave" }]} shift={null} />);
    expect(screen.getByLabelText("Note")).toBeTruthy();
  });
});
