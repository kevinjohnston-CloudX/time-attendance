/**
 * What a phone shows. Kept plain on purpose: a lock screen is read by whoever
 * is nearby, so no reasons, hours or dates, only what happened and where to
 * tap. `href` is the CloudTime page the tap opens.
 */
export type PushMessage = { title: string; body: string; href: string };

/** sent; skipped (that platform is not set up); gone (the phone no longer takes this app's messages). */
export type SendResult = "sent" | "skipped" | "gone";
