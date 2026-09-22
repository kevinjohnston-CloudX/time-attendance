"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { requestWmsSync } from "@/actions/sync.actions";

/**
 * "Sync now" for the WMS bridge.
 *
 * <p>Deliberately does not claim the sync has happened when it returns. Pressing
 * this queues a job; the bridge collects it on its next poll and Oracle is read
 * after that. So the button reports <em>queued</em>, and the page's own tables
 * are what show the result once it lands — which is why it refreshes rather
 * than rendering an outcome of its own.
 *
 * <p>The wait it removes is the cron interval, not the poll. Somebody added to
 * a shift in Oracle is invisible to a gate reading CloudTime's copy until the
 * next pull, and without this the only option is to wait for the schedule.
 */
export function SyncNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function onClick() {
    setNote(null);
    startTransition(async () => {
      const result = await requestWmsSync(undefined);

      if (!result.success) {
        setNote("Could not queue — check your permissions.");
        return;
      }

      // Already-pending is the ordinary case when two people press it inside
      // one poll window, or the cron has just fired. It is not a failure, and
      // saying "queued" there would promise a second pull that will not happen.
      const { queued, alreadyPending } = result.data;
      setNote(
        queued.length > 0
          ? "Queued. The bridge picks it up on its next check-in."
          : alreadyPending.length > 0
            ? "Already queued — waiting on the bridge's next check-in."
            : "Nothing to queue.",
      );

      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        hierarchy="secondary"
        onClick={onClick}
        disabled={pending}
        leadingIcon={<RefreshCw size={16} />}
      >
        {pending ? "Queueing…" : "Sync now"}
      </Button>
      {note ? (
        <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>{note}</span>
      ) : null}
    </div>
  );
}
