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

type CapacitorBridge = {
  isNativePlatform?(): boolean;
  Plugins: {
    App?: {
      addListener(event: "appUrlOpen", cb: (e: { url: string }) => void): Promise<Listener> | Listener;
      getLaunchUrl(): Promise<{ url: string } | undefined> | { url: string } | undefined;
    };
    SplashScreen?: { hide(): Promise<void> | void };
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
  void settle(() => bridge()?.Plugins.SystemBars?.setStyle({ style: darkPage ? "DARK" : "LIGHT" }));
}
