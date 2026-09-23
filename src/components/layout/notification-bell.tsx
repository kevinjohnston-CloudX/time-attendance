"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { WaitingItem } from "@/lib/dashboard/dashboard-data";

/**
 * The bell from the portal design, over what is actually waiting on this
 * person right now.
 *
 * <p>There is no notification table behind it and no read state. The counts
 * are the current state of the queues, which means the dot clears when the
 * work is done rather than when somebody looks at it, and it can never claim
 * a timesheet still needs approving after a colleague approved it.
 *
 * <p>It follows that there is no history here. Something that was waiting and
 * has since been dealt with is gone, which is the right answer for a queue
 * and the wrong one for an audit trail. The audit log is the audit trail.
 */
export function NotificationBell({ items }: { items: WaitingItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const total = items.reduce((n, i) => n + i.count, 0);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-none">
      <button
        onClick={() => setOpen((v) => !v)}
        title={total > 0 ? `${total} waiting on you` : "Nothing waiting on you"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="ta-outlined relative inline-flex h-7 items-center rounded-md px-2"
        style={{
          border: "1px solid var(--stroke-secondary)",
          background: "var(--surface-card)",
          color: "var(--text-secondary)",
        }}
      >
        <Bell className="h-4 w-4" />
        {total > 0 && (
          <span
            aria-hidden
            className="absolute rounded-full"
            style={{
              top: 3,
              right: 4,
              width: 7,
              height: 7,
              background: "var(--fill-accent)",
              outline: "2px solid var(--surface-card)",
            }}
          />
        )}
        <span className="sr-only">{total > 0 ? `${total} waiting on you` : "Nothing waiting on you"}</span>
      </button>

      {open && <WaitingPanel items={items} onNavigate={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The list the bell drops down. Drawn from what it is given, so it can be
 * rendered and looked at without a browser or a session.
 */
export function WaitingPanel({
  items,
  onNavigate,
}: {
  items: WaitingItem[];
  onNavigate?: () => void;
}) {
  return (
      <div
        role="dialog"
        aria-label="Waiting on you"
        className="absolute right-0 z-50 mt-1.5 w-[280px] overflow-hidden rounded-lg"
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--stroke-secondary)",
          boxShadow: "var(--shadow-menu)",
        }}
      >
        <p
          className="px-3 pb-1 pt-2 uppercase"
          style={{ margin: 0, font: "var(--type-overline)", color: "var(--text-tertiary)" }}
        >
          Waiting on you
        </p>

        {items.length === 0 ? (
          <p
            className="px-3 pb-3 pt-1"
            style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}
          >
            Nothing needs you right now.
          </p>
        ) : (
          <div className="flex flex-col pb-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className="ta-hoverable flex h-9 items-center gap-2 px-3"
                style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span
                  className="tabular inline-flex h-4 min-w-[18px] flex-none items-center justify-center rounded-full px-1.5"
                  style={{
                    font: "var(--type-caption2)",
                    background: "var(--wms-color-primary-600)",
                    color: "var(--text-on-accent)",
                  }}
                >
                  {item.count}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
  );
}
