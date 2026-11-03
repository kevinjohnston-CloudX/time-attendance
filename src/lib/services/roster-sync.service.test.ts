import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  employee: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  site: { findMany: vi.fn() },
  employeeBadge: { findMany: vi.fn(), createMany: vi.fn() },
  scanEvent: { groupBy: vi.fn() },
  rosterCandidate: { updateMany: vi.fn(), upsert: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { applyRosterBatch } from "./roster-sync.service";

const person = (id: string, wmsId: string, wmsActive: boolean | null) => ({
  id, wmsId, barcode: null, barcodeOverride: false, isActive: true, wmsName: null, wmsActive,
});

describe("applyRosterBatch: WMS's view of who is employed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.site.findMany.mockResolvedValue([]);
    db.employeeBadge.findMany.mockResolvedValue([]);
    db.scanEvent.groupBy.mockResolvedValue([]);
    db.employee.findMany.mockResolvedValue([
      person("a", "100001", null),
      person("b", "100002", null),
      person("c", "100003", true),
      person("d", "100004", null),
      person("e", "100005", false),
    ]);
  });

  const written = (value: boolean) =>
    db.employee.updateMany.mock.calls.find(([q]) => q.data.wmsActive === value)?.[0].where.id.in ?? [];

  it("records terminated only where every row says so, and writes only what changed", async () => {
    await applyRosterBatch("t1", [
      { empId: "100001", isActive: false },
      { empId: "100001", isActive: true }, // a duplicate row saying employed wins
      { empId: "100002", isActive: false },
      { empId: "100003", isActive: true }, // already recorded as employed: no write
      { empId: "100004" }, // says nothing: left as it is
      { empId: "100005", isActive: true }, // rehired in WMS
    ]);
    expect(written(false)).toEqual(["b"]);
    expect(written(true).sort()).toEqual(["a", "e"]);
    for (const [q] of db.employee.updateMany.mock.calls) expect(q.where.tenantId).toBe("t1");
  });

  it("never changes isActive", async () => {
    await applyRosterBatch("t1", [{ empId: "100002", isActive: false }]);
    for (const [q] of db.employee.update.mock.calls) expect(q.data).not.toHaveProperty("isActive");
    for (const [q] of db.employee.updateMany.mock.calls) expect(q.data).not.toHaveProperty("isActive");
  });

  it("writes nothing when WMS agrees with what is stored", async () => {
    await applyRosterBatch("t1", [{ empId: "100003", isActive: true }, { empId: "100005", isActive: false }]);
    expect(db.employee.updateMany).not.toHaveBeenCalled();
  });
});
