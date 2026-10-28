import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { listPeople } = vi.hoisted(() => ({ listPeople: vi.fn() }));
vi.mock("@/lib/api/auth-external", async (real) => ({
  ...(await real<typeof import("@/lib/api/auth-external")>()),
  authenticateApiKey: async () => ({ tenantId: "t1", keyId: "k1", scopes: ["people:read"] }),
}));
vi.mock("@/lib/api/external-people", async (real) => ({
  ...(await real<typeof import("@/lib/api/external-people")>()),
  listPeople,
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "./route";

const call = (qs: string) => GET(new NextRequest(`http://x/api/external/people${qs}`));

describe("GET /api/external/people", () => {
  it("links the next page, keeping the filters", async () => {
    listPeople.mockResolvedValueOnce({ people: [], page: 1, pageSize: 1000, total: 7615 });
    const body = await (await call("?status=all&pageSize=1000")).json();
    expect(body.nextPage).toBe("/api/external/people?status=all&pageSize=1000&page=2");
  });

  it("has no next page on the last one", async () => {
    listPeople.mockResolvedValueOnce({ people: [], page: 8, pageSize: 1000, total: 7615 });
    expect((await (await call("?page=8&pageSize=1000")).json()).nextPage).toBeNull();
  });

  it("takes up to 1000 a page and refuses more", async () => {
    expect((await call("?pageSize=1001")).status).toBe(400);
  });
});
