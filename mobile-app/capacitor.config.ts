import type { CapacitorConfig } from "@capacitor/cli";

// The app is a frame around the live site: every screen comes from the web
// deploy, so a screen change reaches phones without a store review. Only a
// change to this shell (plugins, icon, permissions) needs a new store build.
const LIVE_URL = "https://time-attendance-txzz.vercel.app";

// A test build can open the Mac's own server instead, for example
// CLOUDTIME_URL=http://127.0.0.1:3000 npx cap sync ios. Store builds never set it.
const SITE_URL = process.env.CLOUDTIME_URL ?? LIVE_URL;

const config: CapacitorConfig = {
  // Cannot change after the first store upload. Matches CXT's net.cloudxsystems.cxt.
  appId: "net.cloudxsystems.cloudtime",
  appName: "CloudTime",
  webDir: "www",
  server: {
    url: `${SITE_URL}/dashboard`,
    // Plain http only for a test build against the Mac.
    cleartext: SITE_URL.startsWith("http://"),
    // Shown instead of a blank white screen when the site cannot be reached.
    errorPath: "offline.html",
    // Only CloudTime opens inside the app; any other link goes to the browser.
    // Host names without a port. On the Mac, Next's own redirects say
    // localhost where the address said 127.0.0.1, so a test build allows both.
    allowNavigation: SITE_URL === LIVE_URL ? [new URL(LIVE_URL).hostname] : [new URL(SITE_URL).hostname, "localhost"],
  },
  // Behind the page while it loads: CloudTime's light canvas rather than white.
  backgroundColor: "#F9FAFB",
  ios: {
    contentInset: "never",
  },
  android: {
    // Never let the app load plain http pages.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      // The site lifts it as soon as its first page has drawn
      // (src/components/layout/phone-app-chrome.tsx); this is only the
      // longest it may stay if the page never says so.
      launchShowDuration: 8000,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: "#0860AA",
      showSpinner: false,
    },
    PushNotifications: {
      // Banner, sound and badge while the app is open too.
      presentationOptions: ["badge", "sound", "alert"],
    },
    SystemBars: {
      // The page runs edge to edge and pads itself with env(safe-area-inset-*),
      // as it already does in a phone's browser.
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
