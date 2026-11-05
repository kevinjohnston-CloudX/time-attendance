import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appLocked,
  appLockOffered,
  forgetAppLock,
  LOCK_AFTER_MS,
  markUnlocked,
  onReturnAfterAway,
  setAppLock,
  unlockMethod,
  verifyOwner,
} from "./native-app";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

let stateChange: ((s: { isActive?: boolean }) => void) | null = null;
let biometric: { isAvailable: ReturnType<typeof vi.fn>; verifyIdentity: ReturnType<typeof vi.fn> };

/** A phone app with Face ID: a fresh start has empty session storage. */
function freshStart(keepPhoneStorage = true) {
  if (!keepPhoneStorage) vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
}

beforeEach(() => {
  stateChange = null;
  biometric = {
    isAvailable: vi.fn().mockResolvedValue({ isAvailable: true, biometryType: 2 }),
    verifyIdentity: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal("window", {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        NativeBiometric: biometric,
        App: { addListener: (_e: string, cb: typeof stateChange) => ((stateChange = cb), { remove() {} }) },
      },
    },
  });
  freshStart(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Face ID lock on the phone app", () => {
  it("is off until the person turns it on", () => {
    expect(appLocked()).toBe(false);
    expect(appLockOffered()).toBe(false);
  });

  it("does not lock right after turning it on, but does on the next fresh start", () => {
    setAppLock(true);
    expect(appLocked()).toBe(false);
    freshStart();
    expect(appLocked()).toBe(true);
    markUnlocked();
    expect(appLocked()).toBe(false);
  });

  it("asks only once: Not now is remembered", () => {
    setAppLock(false);
    expect(appLockOffered()).toBe(true);
    freshStart();
    expect(appLocked()).toBe(false);
  });

  it("sign out leaves nothing for the next person", () => {
    setAppLock(true);
    forgetAppLock();
    freshStart();
    expect(appLocked()).toBe(false);
    expect(appLockOffered()).toBe(false);
  });

  it("locks again after 15 minutes away, not sooner", async () => {
    vi.useFakeTimers();
    setAppLock(true);
    const relock = vi.fn();
    onReturnAfterAway(relock);
    await vi.waitFor(() => expect(stateChange).not.toBeNull());

    stateChange!({ isActive: false });
    vi.advanceTimersByTime(LOCK_AFTER_MS - 1000);
    stateChange!({ isActive: true });
    expect(relock).not.toHaveBeenCalled();
    expect(appLocked()).toBe(false);

    stateChange!({ isActive: false });
    vi.advanceTimersByTime(LOCK_AFTER_MS);
    stateChange!({ isActive: true });
    expect(relock).toHaveBeenCalledOnce();
    expect(appLocked()).toBe(true);
  });

  it("names how the phone unlocks, and reports none when nothing is set up", async () => {
    expect(await unlockMethod()).toBe("Face ID");
    biometric.isAvailable.mockResolvedValue({ isAvailable: true, biometryType: 3 });
    expect(await unlockMethod()).toBe("fingerprint");
    // Face ID hardware but no face set up, only the passcode.
    biometric.isAvailable.mockImplementation(async ({ useFallback }: { useFallback: boolean }) => ({ isAvailable: useFallback, biometryType: 2 }));
    expect(await unlockMethod()).toBe("passcode");
    biometric.isAvailable.mockResolvedValue({ isAvailable: false });
    expect(await unlockMethod()).toBeNull();
  });

  it("passes only when the phone says so", async () => {
    expect(await verifyOwner()).toBe(true);
    biometric.verifyIdentity.mockRejectedValue(new Error("User cancelled"));
    expect(await verifyOwner()).toBe(false);
  });
});
