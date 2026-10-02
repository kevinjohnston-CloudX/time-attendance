import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getReportForExport } = vi.hoisted(() => ({ getReportForExport: vi.fn() }));
vi.mock("@/actions/report.actions", () => ({ getReportForExport }));

import { GET } from "./route";

const result = {
  columns: [
    { id: "firstName", label: "First name", exportLabel: "FIRSTNAME", type: "string" },
    { id: "hours", label: "Hours", exportLabel: "HOURS", type: "string" },
  ],
  rows: [{ firstName: "Maria", hours: "08:36:23" }],
  totalRows: 1,
  period: { start: "2026-10-01", end: "2026-10-01", label: "Oct 1, 2026" },
};

const get = (qs = "") => GET(new NextRequest(`http://x/api/reports/r1/export${qs}`), { params: Promise.resolve({ id: "r1" }) });

beforeEach(() => {
  getReportForExport.mockReset();
  getReportForExport.mockResolvedValue({ success: true, data: { name: "Time clock report", brand: "CloudTime", result } });
});

describe("report export", () => {
  it("downloads CSV with the old headings and a CloudTime file name with the day", async () => {
    const res = await get("?format=csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="CloudTime-Time-clock-report-2026-10-01.csv"');
    const text = new TextDecoder().decode(await res.arrayBuffer());
    expect(text.replace(/^﻿/, "").split("\n")).toEqual(["FIRSTNAME,HOURS", "Maria,08:36:23"]);
  });

  it("names a several day file with both ends", async () => {
    getReportForExport.mockResolvedValue({ success: true, data: { name: "CloudTime Time clock report", brand: "CloudTime", result: { ...result, period: { start: "2026-09-01", end: "2026-09-30", label: "x" } } } });
    const res = await get("?format=csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="CloudTime-Time-clock-report-2026-09-01-to-2026-09-30.csv"');
  });

  it("leaves other reports named as they always were", async () => {
    getReportForExport.mockResolvedValue({ success: true, data: { name: "Hours summary", brand: null, result: { ...result, period: undefined } } });
    expect((await get("?format=csv")).headers.get("content-disposition")).toBe('attachment; filename="Hours-summary.csv"');
  });

  it("serves Excel and PDF", async () => {
    const xlsx = await get("?format=xlsx");
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
    expect(xlsx.headers.get("content-disposition")).toContain("CloudTime-Time-clock-report-2026-10-01.xlsx");
    expect((await get("?format=pdf")).headers.get("content-type")).toBe("application/pdf");
  });

  it("passes the dates on screen through to the report", async () => {
    const range = { type: "calendar", unit: "month", which: "last" };
    await get(`?format=csv&range=${encodeURIComponent(JSON.stringify(range))}`);
    expect(getReportForExport).toHaveBeenCalledWith({ id: "r1", dateRange: range });
  });

  it("refuses an unknown format and unreadable dates", async () => {
    expect((await get("?format=exe")).status).toBe(400);
    expect((await get("?range=%7Bnot-json")).status).toBe(400);
  });

  it("answers 404, not 403, for a report the caller cannot open, and 401 when signed out", async () => {
    getReportForExport.mockResolvedValue({ success: false, error: "FORBIDDEN" });
    expect((await get()).status).toBe(404);
    getReportForExport.mockResolvedValue({ success: false, error: "No ReportDefinition found" });
    expect((await get()).status).toBe(404);
    getReportForExport.mockResolvedValue({ success: false, error: "UNAUTHENTICATED" });
    expect((await get()).status).toBe(401);
  });
});
