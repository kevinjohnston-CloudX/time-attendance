// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { runReport, createReport, push } = vi.hoisted(() => ({
  runReport: vi.fn(),
  createReport: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/actions/report.actions", () => ({ runReport, createReport }));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

import { ReportBuilder } from "./report-builder";
import { ReportTypeDialog } from "../report-type-dialog";

const SCAN_COLUMNS = [
  ["firstName", "First name"], ["lastName", "Last name"], ["wmsUserId", "WMS user ID"], ["agency", "Agency"],
  ["warehouseName", "Warehouse"], ["employeeCode", "Employee ID"], ["inTime", "In time"], ["outTime", "Out time"],
  ["hours", "Hours"], ["department", "Department"],
].map(([id, label]) => ({ id, label, type: "string", defaultVisible: true }));

const meta = (id: string, label: string) => ({
  id: id as never,
  label,
  description: "d",
  icon: "x",
  columns: [...SCAN_COLUMNS, { id: "date", label: "Date", type: "string", defaultVisible: false }],
  filters: [{ id: "siteId", label: "Warehouse", type: "string", operators: ["eq", "in"] }],
  groupableFields: [],
});
const payMeta = { ...meta("HOURS_SUMMARY", "Hours summary"), columns: [{ id: "employeeName", label: "Employee", type: "string", defaultVisible: true }] };

const options = {
  sites: [{ id: "s1", name: "0299 Rutherford" }],
  departments: [],
  payPeriods: [{ id: "pp1", startDate: "2026-09-27T00:00:00Z", endDate: "2026-10-10T00:00:00Z", status: "OPEN" }],
  leaveTypes: [],
  payCodes: [],
};

const sources = [meta("SECURITY_SCAN", "Security scan report"), meta("TIME_CLOCK_SCAN", "Time clock report"), payMeta];

beforeEach(() => {
  runReport.mockReset();
  createReport.mockReset();
  push.mockReset();
  runReport.mockResolvedValue({ success: true, data: { columns: [{ id: "firstName", label: "First name", type: "string" }], rows: [{ firstName: "Maria" }], totalRows: 1 } });
  createReport.mockResolvedValue({ success: true, data: { id: "new1" } });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("New report window", () => {
  it("lists the two scan reports in their own group and opens the one picked", () => {
    const onPick = vi.fn();
    render(<ReportTypeDialog sources={sources.map((s) => ({ id: s.id, label: s.label, description: s.description, icon: s.icon }))} onPick={onPick} onClose={() => {}} />);
    expect(screen.getByText("Daily scans")).toBeTruthy();
    expect(screen.getAllByText("Security scan report").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Time clock report").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("option", { name: /Time clock report/ }));
    fireEvent.click(screen.getByRole("button", { name: /Set up this report/ }));
    expect(onPick).toHaveBeenCalledWith("TIME_CLOCK_SCAN");
  });
});

describe("Report builder on a scan report", () => {
  const open = (initial = "SECURITY_SCAN") =>
    render(<ReportBuilder dataSources={sources as never} filterOptions={options as never} initialSource={initial as never} />);

  it("opens on yesterday with the ten columns of the old file, and previews it", async () => {
    open();
    await waitFor(() => expect(runReport).toHaveBeenCalled());
    const sent = runReport.mock.calls[0][0];
    expect(sent.dataSource).toBe("SECURITY_SCAN");
    expect(sent.config.dateRange).toEqual({ type: "yesterday" });
    expect(sent.config.columns).toEqual(SCAN_COLUMNS.map((c) => c.id));
    expect(screen.getAllByText(/Yesterday/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Pay period" })).toBeNull();
    expect(screen.getByRole("button", { name: "Week, month or year" })).toBeTruthy();
  });

  it("saves with room for a month of rows and the period as a moving choice", async () => {
    open();
    await waitFor(() => expect(runReport).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Week, month or year" }));
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    // The window that asks for a name has its own Save report button, last on the page.
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Save report" }).length).toBe(2));
    fireEvent.click(screen.getAllByRole("button", { name: "Save report" })[1]);
    await waitFor(() => expect(createReport).toHaveBeenCalled());
    const body = createReport.mock.calls[0][0];
    expect(body.dataSource).toBe("SECURITY_SCAN");
    expect(body.config.limit).toBe(50000);
    expect(body.config.dateRange).toEqual({ type: "calendar", unit: "month", which: "last" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reports/new1"));
  });

  it("keeps the usual limit and pay period start for other reports", async () => {
    render(<ReportBuilder dataSources={sources as never} filterOptions={options as never} initialSource={"HOURS_SUMMARY" as never} />);
    await waitFor(() => expect(runReport).toHaveBeenCalled());
    expect(runReport.mock.calls[0][0].config.dateRange.type).toBe("payPeriod");
    expect(screen.getByRole("button", { name: "Pay period" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Week, month or year" })).toBeNull();
  });
});
