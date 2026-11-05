"use client";

import { Download } from "lucide-react";
import { inPhoneApp, openInAppBrowser } from "@/lib/native-app";
import styles from "./documents.module.css";

/**
 * Download stays a plain anchor rather than LinkButton.
 *
 * <p>The file streams out of an API route, so there is no page for the router
 * to prefetch or transition to, and target=_blank leaves the list on screen
 * behind the download. It borrows the secondary button's palette variables so
 * it hovers like the real thing.
 */
export function DownloadLink({ id, title }: { id: string; title: string }) {
  return (
    <a
      href={`/api/documents/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={async (e) => {
        // In the phone app the link is fetched first and opened in the app's
        // own browser; see the route. A browser downloads as before.
        if (!inPhoneApp()) return;
        e.preventDefault();
        const res = await fetch(`/api/documents/${id}?as=url`).catch(() => null);
        const body = res?.ok ? ((await res.json().catch(() => null)) as { url?: string } | null) : null;
        if (body?.url) await openInAppBrowser(body.url);
      }}
      title={`Download ${title}`}
      className={`${styles.download} wms-btn inline-flex h-6 flex-none items-center gap-1.5 rounded-md px-2.5`}
      style={{
        ["--bg" as string]: "var(--surface-card)",
        ["--bg-h" as string]: "var(--fill-hover)",
        ["--bg-a" as string]: "var(--fill-pressed)",
        ["--fg" as string]: "var(--text-primary)",
        ["--fg-h" as string]: "var(--text-primary)",
        border: "1px solid var(--stroke-default)",
        font: "var(--type-button2)",
        textDecoration: "none",
      }}
    >
      <Download className="h-3.5 w-3.5" />
      <span>Download</span>
    </a>
  );
}
