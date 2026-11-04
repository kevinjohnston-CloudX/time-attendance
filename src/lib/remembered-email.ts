"use client";

import { useSyncExternalStore } from "react";

const KEY = "ta.signin.email";
const PENDING_KEY = "ta.signin.remember-pending";

/**
 * The email "Remember me" keeps on this browser, so the sign-in page can fill
 * it in next time. Only ever the address, never the password: that stays with
 * the browser's own password manager, which is built to hold one.
 *
 * <p>Read through useSyncExternalStore, like the sidebar's choices, because
 * the server cannot know what this browser stored. The first render is empty
 * and the address arrives straight after.
 */
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export const rememberedEmailStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
  get(): string {
    try {
      return window.localStorage.getItem(KEY) ?? "";
    } catch {
      return ""; // private window, blocked storage
    }
  },
  getServer(): string {
    return "";
  },
  save(email: string) {
    try {
      window.localStorage.setItem(KEY, email);
    } catch {
      /* the sign-in still worked, so nothing to report */
    }
    notify();
  },
  forget() {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing stored to remove */
    }
    notify();
  },
  /**
   * Google sign in leaves this page before the address is known, so Remember
   * me is noted here and the address saved once the person is back signed in
   * (RememberGoogleEmail in app/_components/providers.tsx).
   */
  saveAfterSignIn(on: boolean) {
    try {
      if (on) window.localStorage.setItem(PENDING_KEY, "1");
      else window.localStorage.removeItem(PENDING_KEY);
    } catch {
      /* the sign in still goes ahead */
    }
  },
  /** The signed in address, saved if Remember me was ticked before Google sign in. */
  finishSignIn(email: string) {
    try {
      if (window.localStorage.getItem(PENDING_KEY) !== "1") return;
      window.localStorage.removeItem(PENDING_KEY);
    } catch {
      return;
    }
    rememberedEmailStore.save(email);
  },
};

export function useRememberedEmail(): string {
  return useSyncExternalStore(rememberedEmailStore.subscribe, rememberedEmailStore.get, rememberedEmailStore.getServer);
}
