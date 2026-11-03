import type { CapacitorConfig } from "@capacitor/cli";

// The app is a frame around the live site: every screen comes from the web
// deploy, so a screen change reaches phones without a store review. Only a
// change to this shell (plugins, icon, permissions) needs a new store build.
const LIVE_URL = "https://time-attendance-txzz.vercel.app";

const config: CapacitorConfig = {
  // Cannot change after the first store upload. Matches CXT's net.cloudxsystems.cxt.
  appId: "net.cloudxsystems.cloudtime",
  appName: "CloudTime",
  webDir: "www",
  server: {
    url: `${LIVE_URL}/dashboard`,
    // Shown instead of a blank white screen when the site cannot be reached.
    errorPath: "offline.html",
    // Only CloudTime opens inside the app; any other link goes to the browser.
    allowNavigation: [new URL(LIVE_URL).host],
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
