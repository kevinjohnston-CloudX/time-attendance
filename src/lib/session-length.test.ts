import { describe, expect, it } from "vitest";
import { signInEnded } from "./session-length";

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 4, 15);

describe("signInEnded", () => {
  it("keeps a sign in without Remember me for a working day", () => {
    expect(signInEnded({ signedInAt: now - 11 * HOUR, remember: false }, now)).toBe(false);
    expect(signInEnded({ signedInAt: now - 13 * HOUR, remember: false }, now)).toBe(true);
  });

  it("keeps a remembered sign in for 30 days, then ends it", () => {
    expect(signInEnded({ signedInAt: now - 13 * HOUR, remember: true }, now)).toBe(false);
    expect(signInEnded({ signedInAt: now - 29 * 24 * HOUR, remember: true }, now)).toBe(false);
    expect(signInEnded({ signedInAt: now - 31 * 24 * HOUR, remember: true }, now)).toBe(true);
  });

  it("gives a sign in from before the rule a working day from when it is first seen", () => {
    const token: Record<string, unknown> = { remember: undefined };
    expect(signInEnded(token, now)).toBe(false);
    expect(token.signedInAt).toBe(now);
    expect(signInEnded(token, now + 13 * HOUR)).toBe(true);
  });

  it("treats anything but true as not remembered", () => {
    expect(signInEnded({ signedInAt: now - 13 * HOUR, remember: "1" }, now)).toBe(true);
  });
});
