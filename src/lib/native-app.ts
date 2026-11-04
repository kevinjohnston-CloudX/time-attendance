/**
 * The phone app (mobile-app/) is a native frame around this site. Inside it,
 * Capacitor puts a bridge on window; in any ordinary browser there is none,
 * and everything here does nothing. Read through window rather than imported,
 * so the site carries no app package and a page is the same in both.
 */

type Listener = { remove(): Promise<void> | void };

/**
 * The bridge's plugin calls answer with a promise or with the value itself,
 * depending on the call and the Capacitor version. Never trusted to be
 * either, and never allowed to throw into the page: a failure here must leave
 * the sign-in page working, only without the app's extras.
 */
function settle<T>(call: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return Promise.resolve(call()).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

type CapacitorBridge = {
  isNativePlatform?(): boolean;
  getPlatform?(): string;
  Plugins: {
    App?: {
      addListener(event: "appUrlOpen", cb: (e: { url: string }) => void): Promise<Listener> | Listener;
      addListener(event: "appStateChange", cb: (s: { isActive?: boolean }) => void): Promise<Listener> | Listener;
      getLaunchUrl(): Promise<{ url: string } | undefined> | { url: string } | undefined;
    };
    // @capgo/capacitor-native-biometric: Face ID, Touch ID or fingerprint. Rejects when the person does not pass.
    NativeBiometric?: {
      isAvailable(options: { useFallback: boolean }):
        | Promise<{ isAvailable?: boolean; biometryType?: number }>
        | { isAvailable?: boolean; biometryType?: number };
      verifyIdentity(options: {
        reason: string;
        title: string;
        negativeButtonText: string;
        useFallback: boolean;
        maxAttempts: number;
      }): Promise<void> | void;
    };
    SplashScreen?: { hide(): Promise<void> | void };
    PushNotifications?: {
      checkPermissions(): Promise<{ receive: PermissionState }> | { receive: PermissionState };
      requestPermissions(): Promise<{ receive: PermissionState }> | { receive: PermissionState };
      register(): Promise<void> | void;
      unregister(): Promise<void> | void;
      addListener(event: "registration", cb: (t: { value: string }) => void): Promise<Listener> | Listener;
      addListener(
        event: "pushNotificationActionPerformed",
        cb: (a: { notification?: { data?: { href?: unknown } } }) => void,
      ): Promise<Listener> | Listener;
    };
    // Capacitor's own: the colour of the clock, battery and signal icons.
    SystemBars?: { setStyle(options: { style: "LIGHT" | "DARK" }): Promise<void> | void };
    Browser?: {
      open(options: { url: string; presentationStyle?: "fullscreen" | "popover" }): Promise<void> | void;
      close(): Promise<void> | void;
      addListener(event: "browserFinished", cb: () => void): Promise<Listener> | Listener;
    };
  };
};

const VERIFIER_KEY = "cloudtime.app-signin";

function bridge(): CapacitorBridge | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

/** True inside the phone app, false in any browser. */
export function inPhoneApp(): boolean {
  return bridge() !== null;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Opens sign in in the phone's own browser (lib/app-signin.ts). The verifier
 * stays in this page's storage; only its hash goes out. Returns false when
 * this is not the app or the app has no browser to open.
 */
export async function startAppSignin(onClosed: () => void): Promise<boolean> {
  const browser = bridge()?.Plugins.Browser;
  if (!browser) return false;
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  try {
    localStorage.setItem(VERIFIER_KEY, verifier);
  } catch {
    return false;
  }
  const closed = await settle(() =>
    browser.addListener("browserFinished", () => {
      void settle(() => closed?.remove());
      onClosed();
    }),
  );
  await settle(() => browser.open({ url: `${window.location.origin}/api/app-signin?challenge=${challenge}`, presentationStyle: "popover" }));
  return true;
}

/**
 * Calls back with the code and verifier when the browser hands the app back
 * its sign in, whether the app was waiting or had to be started again.
 * Returns the cleanup.
 */
export function onAppSigninReturn(cb: (code: string, verifier: string) => void): () => void {
  const app = bridge()?.Plugins.App;
  if (!app) return () => {};
  let listener: Listener | null = null;
  let done = false;

  const take = (url: string | undefined) => {
    if (done || !url?.includes("://signed-in")) return;
    const code = new URL(url).searchParams.get("code");
    let verifier: string | null = null;
    try {
      verifier = localStorage.getItem(VERIFIER_KEY);
      localStorage.removeItem(VERIFIER_KEY);
    } catch {}
    if (!code || !verifier) return;
    done = true;
    void settle(() => bridge()?.Plugins.Browser?.close());
    cb(code, verifier);
  };

  let removed = false;
  void settle(() => app.addListener("appUrlOpen", (e) => take(e?.url))).then((l) => {
    listener = l ?? null;
    if (removed) void settle(() => listener?.remove());
  });
  void settle(() => app.getLaunchUrl()).then((launch) => take(launch?.url));
  return () => {
    removed = true;
    done = true;
    void settle(() => listener?.remove());
  };
}

/** Lifts the app's launch screen once the page has drawn, so nothing flashes white in between. */
export function hideLaunchScreen(): void {
  void settle(() => bridge()?.Plugins.SplashScreen?.hide());
}

/**
 * Matches the phone's status bar icons to the page: dark icons over the light
 * theme, light icons over the dark one. The app cannot tell which theme the
 * person chose here, so the page says.
 */
export function matchSystemBars(darkPage: boolean): void {
  const cap = bridge();
  if (!cap) return;
  let dark = darkPage;
  // Android with a WebView older than 140 does not let the page draw under
  // the status bar: Android paints that strip itself, in the phone's own
  // theme, and Capacitor reports a top inset of 0. The icons then follow the
  // phone, or they would be white on white when the page and phone differ.
  if (cap.getPlatform?.() === "android") {
    const inset = getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-top").trim();
    if (inset === "" || inset === "0px") dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  void settle(() => cap.Plugins.SystemBars?.setStyle({ style: dark ? "DARK" : "LIGHT" }));
}

// ─── Notifications ──────────────────────────────────────────────────────────

const PUSH_CHOICE_KEY = "cloudtime.push";
const PUSH_TOKEN_KEY = "cloudtime.push-token";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** The person's own choice on this phone, from the menu. On until they turn it off. */
export function pushChosen(): boolean {
  return stored(PUSH_CHOICE_KEY) !== "off";
}

/** Whether the phone itself lets this app notify (it can be turned off in the phone's settings). */
export async function pushAllowedByPhone(): Promise<boolean | null> {
  const push = bridge()?.Plugins.PushNotifications;
  if (!push) return null;
  const state = await settle(() => push.checkPermissions());
  return state ? state.receive === "granted" : null;
}

function sendToken(method: "POST" | "DELETE", token: string) {
  const platform = bridge()?.getPlatform?.() === "ios" ? "IOS" : "ANDROID";
  return fetch("/api/push/devices", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform }),
  }).catch(() => undefined);
}

let pushStarted = false;
// Listeners are added once per page load; turning notifications off and on again must not double them.
let pushListening = false;
let openPage: (href: string) => void = () => {};

/**
 * Signed in, inside the app: asks the phone's permission once, registers this
 * phone for the signed in person, and opens the page a tapped notification
 * points to. Does nothing in a browser or when the person turned
 * notifications off in the menu. `open` navigates inside CloudTime.
 */
export async function startPushNotifications(open: (href: string) => void): Promise<void> {
  const push = bridge()?.Plugins.PushNotifications;
  openPage = open;
  if (!push || pushStarted || !pushChosen()) return;
  pushStarted = true;

  if (!pushListening) {
    pushListening = true;
    await settle(() =>
      push.addListener("registration", (t) => {
        if (!t?.value) return;
        store(PUSH_TOKEN_KEY, t.value);
        void sendToken("POST", t.value);
      }),
    );
    await settle(() =>
      push.addListener("pushNotificationActionPerformed", (a) => {
        const href = a?.notification?.data?.href;
        // Only a page of this site, never an address from outside it.
        if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) openPage(href);
      }),
    );
  }

  let state = (await settle(() => push.checkPermissions()))?.receive;
  if (state === "prompt" || state === "prompt-with-rationale") state = (await settle(() => push.requestPermissions()))?.receive;
  if (state === "granted") await settle(() => push.register());
}

/**
 * Stops notifications on this phone for whoever is signed in: on sign out,
 * and when the person turns them off. `remember` keeps them off next time.
 */
export async function stopPushNotifications(remember: boolean): Promise<void> {
  if (remember) store(PUSH_CHOICE_KEY, "off");
  const token = stored(PUSH_TOKEN_KEY);
  if (token) await sendToken("DELETE", token);
  store(PUSH_TOKEN_KEY, null);
  pushStarted = false;
  await settle(() => bridge()?.Plugins.PushNotifications?.unregister());
}

/** The person turned notifications back on in the menu. */
export async function resumePushNotifications(open: (href: string) => void): Promise<void> {
  store(PUSH_CHOICE_KEY, null);
  await startPushNotifications(open);
}

// ─── App lock ───────────────────────────────────────────────────────────────

/**
 * Face ID, Touch ID or fingerprint before the app shows anything, when it
 * opens or after 15 minutes away (components/layout/app-lock.tsx). Each person
 * turns it on for their own phone. Privacy on the phone, not access control:
 * the session and every server check stay exactly as they are.
 *
 * <p>"On" lives in this phone's storage until sign out. "Unlocked" lives in
 * session storage, which the phone empties when the app is closed, so a fresh
 * start always asks.
 */
const LOCK_KEY = "cloudtime.app-lock";
const LOCK_OFFERED_KEY = "cloudtime.app-lock-offered";
const UNLOCKED_KEY = "cloudtime.unlocked";
const AWAY_KEY = "cloudtime.away-since";

/**
 * Inline in the first HTML (app/layout.tsx), so the launch screen lifts as
 * soon as the server's page draws instead of after the page's code has loaded
 * and started, which on a phone is seconds later. Left to the lock when it is
 * on and not yet passed this launch, so the page never shows under it.
 */
export const LIFT_LAUNCH_SCREEN_SCRIPT =
  `try{var c=window.Capacitor;if(c&&c.isNativePlatform&&c.isNativePlatform()&&` +
  `!(localStorage.getItem(${JSON.stringify(LOCK_KEY)})==="on"&&sessionStorage.getItem(${JSON.stringify(UNLOCKED_KEY)})!=="1"))` +
  `c.Plugins.SplashScreen.hide()}catch(e){}`;

/** Away this long and the app asks again. */
export const LOCK_AFTER_MS = 15 * 60 * 1000;

/** How this phone unlocks, for the words on the buttons. */
export type UnlockMethod = "Face ID" | "Touch ID" | "fingerprint" | "passcode";

/** What this phone can unlock with, or null when it has nothing set up (or this is not the app). */
export async function unlockMethod(): Promise<UnlockMethod | null> {
  const bio = bridge()?.Plugins.NativeBiometric;
  if (!bio) return null;
  // An iPhone reports Face ID as its kind even with no face set up, so the
  // name comes from the check without the passcode, and the passcode only
  // when that is all the phone has.
  const face = await settle(() => bio.isAvailable({ useFallback: false }));
  if (face?.isAvailable) {
    // The plugin's BiometryType: 1 Touch ID, 2 Face ID, 3 fingerprint.
    if (face.biometryType === 2) return "Face ID";
    if (face.biometryType === 1) return "Touch ID";
    if (face.biometryType === 3) return "fingerprint";
  }
  const any = await settle(() => bio.isAvailable({ useFallback: true }));
  return any?.isAvailable ? "passcode" : null;
}

/** Asks the phone. True only when the person passed. */
export async function verifyOwner(): Promise<boolean> {
  const bio = bridge()?.Plugins.NativeBiometric;
  if (!bio) return false;
  try {
    await Promise.resolve(
      bio.verifyIdentity({ reason: "Unlock CloudTime", title: "Unlock CloudTime", negativeButtonText: "Cancel", useFallback: true, maxAttempts: 3 }),
    );
    return true;
  } catch {
    return false;
  }
}

export function appLockOn(): boolean {
  return stored(LOCK_KEY) === "on";
}

/** Turned on only after the person passed once, so it is never on for a phone that cannot unlock. */
export function setAppLock(on: boolean) {
  store(LOCK_KEY, on ? "on" : null);
  store(LOCK_OFFERED_KEY, "1");
  if (on) markUnlocked();
}

/** Whether this phone was already asked once since sign in. */
export function appLockOffered(): boolean {
  return stored(LOCK_OFFERED_KEY) === "1";
}

/** Locked now: on, and not unlocked since the app started. */
export function appLocked(): boolean {
  if (!appLockOn()) return false;
  try {
    return sessionStorage.getItem(UNLOCKED_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markUnlocked() {
  try {
    sessionStorage.setItem(UNLOCKED_KEY, "1");
  } catch {}
}

function markLocked() {
  try {
    sessionStorage.removeItem(UNLOCKED_KEY);
  } catch {}
}

/** Sign out: the lock and its one time offer belong to whoever signs in next. */
export function forgetAppLock() {
  store(LOCK_KEY, null);
  store(LOCK_OFFERED_KEY, null);
  markLocked();
}

/**
 * Calls back when the app returns after LOCK_AFTER_MS or more in the
 * background with the lock on, already marked locked. Returns the cleanup.
 */
export function onReturnAfterAway(cb: () => void): () => void {
  const app = bridge()?.Plugins.App;
  if (!app) return () => {};
  let listener: Listener | null = null;
  let removed = false;
  void settle(() =>
    app.addListener("appStateChange", (s) => {
      if (!appLockOn()) return;
      if (!s?.isActive) {
        store(AWAY_KEY, String(Date.now()));
        return;
      }
      const since = Number(stored(AWAY_KEY) ?? 0);
      store(AWAY_KEY, null);
      if (since && Date.now() - since >= LOCK_AFTER_MS) {
        markLocked();
        cb();
      }
    }),
  ).then((l) => {
    listener = l ?? null;
    if (removed) void settle(() => listener?.remove());
  });
  return () => {
    removed = true;
    void settle(() => listener?.remove());
  };
}
