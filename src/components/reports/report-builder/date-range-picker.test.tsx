// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateRangePicker, describeRange } from "./date-range-picker";
import type { DateRange } from "@/lib/validators/report.schema";

afterEach(cleanup);

const labels = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("DateRangePicker for a scan report", () => {
  it("offers calendar days and no pay period", () => {
    render(<DateRangePicker value={{ type: "yesterday" }} onChange={() => {}} payPeriods={[]} scan />);
    expect(labels()).toEqual(expect.arrayContaining(["Pick dates", "Recent days", "Week, month or year"]));
    expect(labels()).not.toContain("Pay period");
  });

  it("moves to last month when Week, month or year is chosen", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ type: "yesterday" }} onChange={onChange} payPeriods={[]} scan />);
    fireEvent.click(screen.getByRole("button", { name: "Week, month or year" }));
    expect(onChange).toHaveBeenCalledWith({ type: "calendar", unit: "month", which: "last" });
  });

  it("goes back to yesterday, not a pay period or a fortnight, from Recent days", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ type: "custom", startDate: "", endDate: "" }} onChange={onChange} payPeriods={[]} scan />);
    fireEvent.click(screen.getByRole("button", { name: "Recent days" }));
    expect(onChange).toHaveBeenCalledWith({ type: "yesterday" });
  });

  it("lists the six calendar periods and reports the pick", () => {
    const onChange = vi.fn();
    const value: DateRange = { type: "calendar", unit: "month", which: "last" };
    render(<DateRangePicker value={value} onChange={onChange} payPeriods={[]} scan />);
    const select = screen.getByLabelText("Which period") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "This week", "Last week", "This month", "Last month", "This year", "Last year",
    ]);
    expect(select.value).toBe("last-month");
    fireEvent.change(select, { target: { value: "this-week" } });
    expect(onChange).toHaveBeenCalledWith({ type: "calendar", unit: "week", which: "this" });
  });

  it("shows the actual dates under the choice, and the Monday start only for weeks", () => {
    const { rerender } = render(<DateRangePicker value={{ type: "calendar", unit: "week", which: "last" }} onChange={() => {}} payPeriods={[]} scan />);
    expect(screen.getByText(/Weeks run Monday to Sunday/)).toBeTruthy();
    rerender(<DateRangePicker value={{ type: "calendar", unit: "year", which: "last" }} onChange={() => {}} payPeriods={[]} scan />);
    expect(screen.queryByText(/Weeks run Monday to Sunday/)).toBeNull();
  });
});

describe("DateRangePicker for the other reports", () => {
  it("is unchanged: no calendar choice", () => {
    render(<DateRangePicker value={{ type: "relative", relativeDays: 14 }} onChange={() => {}} payPeriods={[]} />);
    expect(labels()).not.toContain("Week, month or year");
  });
});

describe("describeRange", () => {
  it("puts a calendar period in words with its dates", () => {
    expect(describeRange({ type: "calendar", unit: "month", which: "last" }, [])).toMatch(/^Last month · /);
    expect(describeRange({ type: "calendar", unit: "year", which: "this" }, [])).toMatch(/^This year · Jan 1 to Dec 31, \d{4}$/);
  });
});
