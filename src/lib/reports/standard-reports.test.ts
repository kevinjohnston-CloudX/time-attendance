import { describe, expect, it, vi } from "vitest";

// The report definitions are only read here, never run.
vi.mock("@/lib/db", () => ({ db: {} }));

import { getDataSource } from "./data-sources";
import { STANDARD_FOLDERS, STANDARD_REPORTS, standardReport } from "./standard-reports";
import { reportConfigSchema } from "@/lib/validators/report.schema";

describe("standard reports", () => {
  it.each(STANDARD_REPORTS.map((r) => [r.id, r] as const))("%s only asks for what its report type has", (_id, r) => {
    const def = getDataSource(r.source);
    const columns = new Set(def.columns.map((c) => c.id));
    for (const c of r.columns) expect(columns, `column ${c}`).toContain(c);
    for (const g of r.groupBy ?? []) expect(def.groupableFields, `group ${g}`).toContain(g);
    for (const s of r.sortBy ?? []) expect(columns, `sort ${s.field}`).toContain(s.field);
    for (const f of r.filters ?? []) {
      const filter = def.filters.find((x) => x.id === f.field);
      expect(filter, `filter ${f.field}`).toBeDefined();
      expect(filter!.operators).toContain(f.operator);
    }
    if (r.across) {
      expect(def.columns.find((c) => c.id === r.across!.field)?.across, `across ${r.across.field}`).toBe(true);
      expect(def.columns.find((c) => c.id === r.across!.value)?.type, `across value ${r.across.value}`).toBe("number");
    }
    if (r.layout?.pageBreak) expect(r.groupBy ?? [], "page break is grouped").toContain(r.layout.pageBreak);
    // And what it opens with is a report the server accepts.
    const dateRange = { type: "payPeriod", payPeriodId: "pp1", allGroups: true, moving: "current" };
    expect(() =>
      reportConfigSchema.parse({ columns: r.columns, filters: r.filters ?? [], groupBy: r.groupBy ?? [], sortBy: r.sortBy ?? [], dateRange, layout: r.layout, across: r.across })
    ).not.toThrow();
  });

  it("has a folder, a unique address and a unique saved name for each", () => {
    const ids = STANDARD_REPORTS.map((r) => r.id);
    const names = STANDARD_REPORTS.map((r) => r.saveName ?? r.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const r of STANDARD_REPORTS) expect(STANDARD_FOLDERS).toContain(r.folder);
  });

  it("finds one by its address and nothing for an unknown one", () => {
    expect(standardReport("summary")?.novaTimeName).toBe("Summary Report.TA");
    expect(standardReport("nope")).toBeUndefined();
    expect(standardReport(undefined)).toBeUndefined();
  });
});
