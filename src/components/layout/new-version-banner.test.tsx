// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The banner shows when a newer build is live and this page changed in it,
 * or when that cannot be told; it stays away when the page is the same, and
 * Not now holds until the next deploy.
 */

let pathname = "/supervisor/on-site";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const OWN = { build: "build-a", pages: { "/(portal)/supervisor/on-site/page": "s1", "/(portal)/leave/page": "l1" } };

function serve(maps: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const name = decodeURIComponent(decodeURIComponent(url.split("/").pop() ?? "")).replace(/\.json$/, "");
      const body = maps[name];
      return { ok: !!body, json: async () => body } as Response;
    }),
  );
}

async function setup() {
  vi.stubEnv("NEXT_PUBLIC_APP_BUILD", "build-a");
  vi.resetModules();
  const lib = await import("@/lib/app-build");
  const { NewVersionBanner } = await import("./new-version-banner");
  render(<NewVersionBanner />);
  return lib;
}

async function deploy(lib: typeof import("@/lib/app-build"), build: string) {
  await act(async () => {
    lib.reportBuild(build);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  pathname = "/supervisor/on-site";
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("NewVersionBanner", () => {
  it("stays away until a newer build is live", async () => {
    serve({ "build-a": OWN });
    await setup();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows when this page changed, with a refresh and a way to say not now", async () => {
    serve({ "build-a": OWN, "build-b": { build: "build-b", pages: { ...OWN.pages, "/(portal)/supervisor/on-site/page": "s2" } } });
    const lib = await setup();
    await deploy(lib, "build-b");
    expect(screen.getByRole("status").textContent).toContain("CloudTime has been updated");
    expect(screen.getByRole("button", { name: /Refresh page/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  it("stays quiet when the deploy left this page alone", async () => {
    serve({ "build-a": OWN, "build-b": { build: "build-b", pages: { ...OWN.pages, "/(portal)/leave/page": "l2" } } });
    const lib = await setup();
    await deploy(lib, "build-b");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows when it cannot tell (no fingerprints for the new build)", async () => {
    serve({ "build-a": OWN });
    const lib = await setup();
    await deploy(lib, "build-b");
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("Not now hides it until the next deploy", async () => {
    serve({ "build-a": OWN });
    const lib = await setup();
    await deploy(lib, "build-b");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    expect(screen.queryByRole("status")).toBeNull();
    await deploy(lib, "build-c");
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
