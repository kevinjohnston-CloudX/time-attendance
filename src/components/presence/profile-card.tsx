"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import type { PresenceDetail } from "@/lib/presence/types";
import { formatTimeOfDay } from "@/lib/utils/date";
import { Face } from "./face";
import { initialsOf } from "./presence-meta";
import styles from "./on-site.module.css";

/**
 * Profile, from Live Attendance: who somebody is at work, and nothing else.
 *
 * <p>Loss prevention uses Live Attendance, and the employee record carries
 * pay, pay rules, a personal email and more. So View profile opens this card
 * instead, with the facts that say who somebody is and who they answer to:
 * name, job title, employee code, site, role, supervisor, hire date and
 * shift. It is drawn from the person panel's own parts (header, badge
 * portrait, name, facts grid) so it reads as part of that page.
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
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
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
  const role = jobTitle ?? detail?.jobTitle;

  return (
    <div className={styles.peScrim} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-card-name"
        className={`${styles.peDialog} ${styles.pcDialog}`}
      >
        <div className={styles.panelHead}>
          <span className={styles.ppEyebrow}>Profile</span>
          <Button hierarchy="tertiary" size="sm" iconOnly aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className={styles.pcBody}>
          <div className={styles.ppProfile}>
            <span className={styles.ppPortrait}>
              <span className={styles.initials} aria-hidden="true">
                {name ? initialsOf(name) : ""}
              </span>
              <Face src={photoUrl} personId={employeeId} alt="" />
            </span>
            <div className={styles.ppWho}>
              <h2 id="profile-card-name" className={styles.ppName} title={name}>
                {name}
              </h2>
              {role && <span className={styles.ppRole}>{role}</span>}
            </div>
          </div>

          <dl className={styles.pcFacts}>
            <Fact label="Employee code" value={v((d) => d.employeeCode)} />
            <Fact label="Hire date" value={detail ? hired : undefined} />
            <Fact label="Site" value={v((d) => d.site)} />
            <Fact label="Role" value={v((d) => d.role)} />
            <Fact label="Supervisor" value={v((d) => d.supervisor ?? "None assigned")} />
            <Fact label="Shift" value={v((d) => d.shift)} sub={shiftHours} />
          </dl>
        </div>
      </div>
    </div>
  );
}

/** One fact, the way the person panel draws its own. */
function Fact({ label, value, sub }: { label: string; value: string | null | undefined; sub?: string | null }) {
  return (
    <div className={styles.ppFact}>
      <dt>{label}</dt>
      {value === undefined ? (
        <dd>
          <span className={styles.skeleton} style={{ width: "60%", height: 14, marginTop: 3 }} />
        </dd>
      ) : (
        <dd title={value ?? undefined}>
          {value ?? "Not set"}
          {sub && <span className={styles.pcSub}>{sub}</span>}
        </dd>
      )}
    </div>
  );
}
