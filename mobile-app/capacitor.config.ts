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
  ios: {
    contentInset: "never",
  },
  android: {
    // Never let the app load plain http pages.
    allowMixedContent: false,
  },
};

export default config;
