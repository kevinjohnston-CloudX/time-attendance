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

  const label = total > 0 ? `${total} waiting on you` : "Nothing waiting on you";

  return (
    <div ref={ref} className="flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        // With something waiting, the button widens into a capsule and the
        // count sits beside the bell, so no count ever covers the icon.
        className={
          total > 0
            ? "ta-pill-btn inline-flex h-7 items-center gap-[5px] rounded-full pl-1.5 pr-[5px]"
            : "ta-pill-btn grid h-7 w-7 place-items-center rounded-full"
        }
        style={{ color: "var(--icon-tertiary)" }}
      >
        <Bell className="h-4 w-4 flex-none" />
        {total > 0 && (
          <span
            aria-hidden
            className="tabular h-[18px] min-w-[18px] whitespace-nowrap rounded-full px-[5px] text-center"
            style={{
              background: "var(--fill-accent)",
              color: "var(--text-on-accent)",
              font: "var(--weight-semibold) 11px/18px var(--font-sans)",
            }}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {/* Anchored to the icon pill, as the handoff does, not to the bell. */}
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
      className="absolute right-0 top-[calc(100%+8px)] z-50 w-[300px] rounded-[14px] p-1.5"
      style={{ background: "var(--surface-card)", boxShadow: "var(--ta-drop-shadow)" }}
    >
      <p
        className="px-2.5 pb-1.5 pt-2 uppercase"
        style={{
          margin: 0,
          font: "var(--weight-semibold) 11px/14px var(--font-sans)",
          letterSpacing: "0.07em",
          color: "var(--text-tertiary)",
        }}
      >
        Waiting on you
      </p>

      {items.length === 0 ? (
        <p className="px-2.5 pb-2.5 pt-1" style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
          Nothing needs you right now.
        </p>
      ) : (
        items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className="ta-pill-btn flex h-[38px] items-center gap-2.5 rounded-[9px] px-2.5"
            style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span
              className="tabular h-[18px] min-w-5 flex-none rounded-full px-1.5 text-center"
              style={{
                background: "var(--surface-info)",
                color: "var(--text-accent)",
                font: "var(--weight-semibold) 11px/18px var(--font-sans)",
              }}
            >
              {item.count}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
