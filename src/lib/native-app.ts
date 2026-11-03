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
      getLaunchUrl(): Promise<{ url: string } | undefined> | { url: string } | undefined;
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
