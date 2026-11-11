"use client";

import { UserRound } from "lucide-react";
import { Window, WindowCard } from "@/components/ui/window";
import type { PresenceDetail } from "@/lib/presence/types";
import { formatTimeOfDay } from "@/lib/utils/date";
import { Face } from "./face";
import { initialsOf } from "./presence-meta";
import styles from "./profile-card.module.css";

/**
 * Profile, from Live Attendance: who somebody is at work, and nothing else.
 *
 * <p>Loss prevention uses Live Attendance, and the employee record carries
 * pay, pay rules, a personal email and more. So View profile opens this card
 * instead, with the facts that say who somebody is and who they answer to:
 * name, job title, employee code, site, role, supervisor, hire date and
 * shift. It is a window on the shared frame, laid out like My profile, and
 * Escape closes it without closing the panel under it.
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
  const role = jobTitle ?? detail?.jobTitle ?? detail?.department;

  return (
    <Window width={520} icon={<UserRound />} title="Profile" subtitle="Who they are at work" onClose={onClose}>
      <WindowCard>
        <div className={styles.hero}>
          <span className={styles.photo}>
            <span aria-hidden="true">{name ? initialsOf(name) : ""}</span>
            <Face src={photoUrl} personId={employeeId} alt="" />
          </span>
          <span className={styles.heroText}>
            <span className={styles.name} title={name}>
              {name}
            </span>
            {role && (
              <span className={styles.role} title={role}>
                {role}
              </span>
            )}
          </span>
        </div>
        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>Employment</h3>
          <dl className={styles.grid}>
            <Fact label="Employee code" value={v((d) => d.employeeCode)} />
            <Fact label="Hire date" value={detail ? hired : undefined} />
            <Fact label="Site" value={v((d) => d.site)} />
            <Fact label="Role" value={v((d) => d.role)} />
            <Fact label="Supervisor" value={v((d) => d.supervisor ?? "None assigned")} />
            <Fact label="Shift" value={v((d) => d.shift)} sub={shiftHours} />
          </dl>
        </div>
      </WindowCard>
    </Window>
  );
}

/** One fact: its label over its value, or a quiet bar while it loads. */
function Fact({ label, value, sub }: { label: string; value: string | null | undefined; sub?: string | null }) {
  return (
    <div className={styles.cell}>
      <dt className={styles.cellLabel}>{label}</dt>
      <dd className={styles.cellValue} data-empty={value === null || undefined} title={value ?? undefined}>
        {value === undefined ? (
          <span className={styles.wait} />
        ) : (
          <>
            <span>{value ?? "Not set"}</span>
            {sub && <span className={styles.sub}>{sub}</span>}
          </>
        )}
      </dd>
    </div>
  );
}
