import { afterEach, describe, expect, it, vi } from "vitest";
import { pageChanged, routeKeyFor } from "./app-build";

/**
 * The new version banner's two questions: which page is this address, and
 * did it change between the tab's build and the live one.
 */

const KEYS = [
  "/page",
  "/(portal)/leave/page",
  "/(portal)/leave/[id]/page",
  "/(portal)/leave/new/page",
  "/(portal)/supervisor/on-site/page",
  "/(portal)/time/timesheet/[id]/page",
  "/(auth)/login/page",
  "/_not-found/page",
];

describe("routeKeyFor", () => {
  it("skips group folders and matches the address", () => {
    expect(routeKeyFor("/supervisor/on-site", KEYS)).toBe("/(portal)/supervisor/on-site/page");
    expect(routeKeyFor("/login", KEYS)).toBe("/(auth)/login/page");
    expect(routeKeyFor("/", KEYS)).toBe("/page");
  });
  it("prefers the literal page over a placeholder, as the router does", () => {
    expect(routeKeyFor("/leave/new", KEYS)).toBe("/(portal)/leave/new/page");
    expect(routeKeyFor("/leave/abc123", KEYS)).toBe("/(portal)/leave/[id]/page");
  });
  it("finds no page for an address the build does not have", () => {
    expect(routeKeyFor("/nowhere/at/all", KEYS)).toBeNull();
  });
});

describe("pageChanged", () => {
  const from = { "/(portal)/leave/page": "a1", "/(portal)/supervisor/on-site/page": "b1" };
  it("answers no when the page's fingerprint is the same", () => {
    expect(pageChanged("/supervisor/on-site", from, { ...from, "/(portal)/leave/page": "a2" })).toBe("no");
  });
  it("answers yes when it differs", () => {
    expect(pageChanged("/leave", from, { ...from, "/(portal)/leave/page": "a2" })).toBe("yes");
  });
  it("answers unknown without both builds' fingerprints, or for a page that is new", () => {
    expect(pageChanged("/leave", null, from)).toBe("unknown");
    expect(pageChanged("/leave", from, null)).toBe("unknown");
    expect(pageChanged("/reports", from, { ...from, "/(portal)/reports/page": "c1" })).toBe("unknown");
  });
});

describe("reportBuild", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("tells listeners only about a build other than the tab's own, once each", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_BUILD", "build-a");
    vi.resetModules();
    const { reportBuild, onNewBuild } = await import("./app-build");
    const seen: string[] = [];
    onNewBuild((b) => seen.push(b));
    reportBuild("build-a");
    reportBuild(null);
    reportBuild("build-b");
    reportBuild("build-b");
    reportBuild("build-c");
    expect(seen).toEqual(["build-b", "build-c"]);
    // A listener that arrives later hears the newest at once.
    const late: string[] = [];
    onNewBuild((b) => late.push(b));
    expect(late).toEqual(["build-c"]);
  });
});
