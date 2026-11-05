import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/presence/photos", () => ({ photoUrls: vi.fn() }));
vi.mock("@/lib/supabase-storage", () => ({ createSignedUrl: vi.fn() }));
vi.mock("@/lib/crypto/pii", () => ({ decryptPii: () => null }));
vi.mock("@/components/admin/person-data-window", () => ({ Shell: () => null }));

import { EXPORT_TABLES } from "./company-export";
import { COMPANY_EXPORT_GROUPS } from "@/components/admin/company-export-window";
import { csvField } from "./zip-stream";

describe("company export tables", () => {
  it("holds every table to the company and names each file once", () => {
    expect(new Set(EXPORT_TABLES.map((t) => t.file)).size).toBe(EXPORT_TABLES.length);
    for (const t of EXPORT_TABLES) expect(t.where).toContain("$1");
  });

  it("matches what the window says the file holds", () => {
    for (const g of COMPANY_EXPORT_GROUPS) expect(EXPORT_TABLES.filter((t) => t.group === g.title).length).toBe(g.files);
    expect(COMPANY_EXPORT_GROUPS.reduce((n, g) => n + g.files, 0)).toBe(EXPORT_TABLES.length);
  });

  it("never exports a sign in secret", () => {
    const tables = EXPORT_TABLES.map((t) => t.table);
    for (const secret of ["accounts", "sessions", "refresh_tokens", "password_reset_tokens", "verification_tokens", "push_devices"]) expect(tables).not.toContain(secret);
    expect(EXPORT_TABLES.find((t) => t.table === "users")?.omit).toContain("passwordHash");
    expect(EXPORT_TABLES.find((t) => t.table === "api_keys")?.omit).toContain("keyHash");
  });
});

describe("csvField", () => {
  it("quotes only what needs it, and writes dates and objects so a program reads them back", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField(null)).toBe("");
    expect(csvField(new Date("2026-11-04T15:00:00Z"))).toBe("2026-11-04T15:00:00.000Z");
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
  });
});
