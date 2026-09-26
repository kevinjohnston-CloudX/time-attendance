"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import type { PresenceDetail } from "@/lib/presence/types";
import { formatTimeOfDay } from "@/lib/utils/date";
import { Face } from "./face";
import { initialsOf } from "./presence-meta";

/**
 * Profile, from Live Attendance: who somebody is at work, and nothing else.
 *
 * <p>Loss prevention uses Live Attendance, and the employee record behind
 * View profile carries pay, pay rules, a personal email and more. So the
 * link opens this card instead, with the handful of facts that say who
 * somebody is and who they answer to: name, job title, employee code, site,
 * role, supervisor, hire date and shift.
 *
 * <p>Every value comes from the person detail the panel already loaded,
 * which is gated on PRESENCE_VIEW_ANY and scoped to the site. Nothing here
 * reads the employee record, and the card deliberately does not link to it,
 * for anyone: Live Attendance is not a way into pay or personal details.
 */
export function ProfileCard({
  detail,
  employeeId,
  name,
  jobTitle,
  photoUrl,
  onClose,
}: {
  /** Null while the person is still loading. */
  detail: PresenceDetail | null;
  employeeId: string;
  name: string;
  jobTitle: string | null;
  photoUrl: string | null | undefined;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Escape closes this card, not the panel under it; focus comes back after.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  const shiftHours =
    detail?.shiftStart && detail.shiftEnd
      ? `${formatTimeOfDay(detail.shiftStart)} to ${formatTimeOfDay(detail.shiftEnd)}`
      : null;
  const hired = detail?.hireDate
    ? new Date(`${detail.hireDate}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
  // Undefined while loading draws a placeholder bar; null is a real "none".
  const v = <T,>(pick: (d: PresenceDetail) => T) => (detail ? pick(detail) : undefined);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-card-name"
        className="ta-modal relative flex w-full max-w-[520px] flex-col overflow-hidden"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <span className="absolute right-3 top-3">
          <Button hierarchy="tertiary" iconOnly onClick={onClose} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </span>

        {/* Who: the photo large enough to recognise somebody by, as on a badge. */}
        <div className="flex items-center gap-5 px-6 pb-5 pt-6">
          <span
            className="relative flex h-[88px] w-[88px] flex-none items-center justify-center overflow-hidden [&>img]:absolute [&>img]:inset-0 [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
            style={{
              borderRadius: 18,
              background: "var(--surface-tertiary)",
              color: "var(--text-secondary)",
              font: "var(--weight-semibold) 28px/1 var(--font-sans)",
              boxShadow: "inset 0 0 0 1px var(--stroke-divider)",
            }}
          >
            <span aria-hidden="true">{name ? initialsOf(name) : ""}</span>
            <Face src={photoUrl} personId={employeeId} alt="" />
          </span>
          <span className="flex min-w-0 flex-col gap-1 pr-8">
            <h2
              id="profile-card-name"
              className="truncate"
              title={name}
              style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}
            >
              {name}
            </h2>
            {(jobTitle ?? detail?.jobTitle) && (
              <span className="truncate" style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                {jobTitle ?? detail?.jobTitle}
              </span>
            )}
          </span>
        </div>

        <dl
          className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 px-6 py-5"
          style={{ borderTop: "1px solid var(--stroke-divider)", background: "var(--surface-secondary)" }}
        >
          <Item label="Employee code" value={v((d) => d.employeeCode)} tabular />
          <Item label="Site" value={v((d) => d.site)} />
          <Item label="Role" value={v((d) => d.role)} />
          <Item label="Supervisor" value={v((d) => d.supervisor ?? "None assigned")} />
          <Item label="Hire date" value={detail ? hired : undefined} tabular />
          <Item
            label="Shift"
            value={v((d) => d.shift)}
            sub={shiftHours}
          />
        </dl>

        <div
          className="flex items-center justify-end gap-2 px-6 py-3"
          style={{ borderTop: "1px solid var(--stroke-divider)" }}
        >
          <Button hierarchy="secondary" onClick={onClose} data-autofocus>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function Item({
  label,
  value,
  sub,
  tabular = false,
}: {
  label: string;
  /** Undefined while loading. */
  value: string | null | undefined;
  sub?: string | null;
  tabular?: boolean;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{label}</dt>
      <dd
        className={`m-0 truncate ${tabular ? "tabular" : ""}`}
        title={value ?? undefined}
        style={{
          font: "var(--type-body1)",
          fontWeight: "var(--weight-semibold)",
          color: value ? "var(--text-primary)" : "var(--text-tertiary)",
        }}
      >
        {value === undefined ? (
          <span
            className="inline-block h-4 w-24 rounded"
            style={{ background: "var(--surface-tertiary)", verticalAlign: "middle" }}
            aria-label="Loading"
          />
        ) : (
          value || "Not set"
        )}
      </dd>
      {sub && <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{sub}</span>}
    </div>
  );
}
