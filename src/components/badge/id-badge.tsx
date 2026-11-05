import { Building2 } from "lucide-react";
import { CloudTimeLockup } from "@/components/layout/cloudtime-logo";
import type { IdBadge as IdBadgeData } from "@/lib/badge/badge.service";
import styles from "./id-badge.module.css";

const ROLE_WORD: Record<IdBadgeData["kind"], string> = {
  EMPLOYEE: "Employee",
  VISITOR: "Visitor",
};

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * The ID badge card: a role band a guard reads from across the lobby, who
 * the person is, and the code the door scans. Drawn the same on a phone, in
 * the app and on a desktop screen.
 */
export function IdBadge({ badge }: { badge: IdBadgeData }) {
  const role = ROLE_WORD[badge.kind];
  return (
    <article
      className={styles.badge}
      data-kind={badge.kind.toLowerCase()}
      data-active={badge.active}
      aria-label={`${role} badge for ${badge.name}`}
    >
      <header className={styles.band}>
        <span className={styles.role}>{badge.active ? role : `${role}, not active`}</span>
      </header>

      <div className={styles.identity}>
        <div className={styles.photo}>
          {badge.photo ? (
            // A signed link to the private bucket: next/image would proxy and cache it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badge.photo} alt="" />
          ) : (
            <span aria-hidden="true">{initials(badge.name)}</span>
          )}
        </div>
        <div className={styles.who}>
          <h2 className={styles.name}>{badge.name}</h2>
          {badge.jobTitle && <p className={styles.title}>{badge.jobTitle}</p>}
          <p className={styles.site}>
            <Building2 className={styles.siteIcon} aria-hidden="true" />
            <span className="truncate">{badge.site}</span>
          </p>
        </div>
      </div>

      {badge.qr ? (
        <div className={styles.plate}>
          <svg
            className={styles.qr}
            viewBox={`0 0 ${badge.qr.size} ${badge.qr.size}`}
            shapeRendering="crispEdges"
            role="img"
            aria-label={`Badge code ${badge.number}`}
          >
            <path d={badge.qr.path} />
          </svg>
        </div>
      ) : (
        <div className={styles.inactive}>
          <p className={styles.inactiveTitle}>This badge does not open doors</p>
          <p className={styles.inactiveBody}>The account is not active. HR can turn it back on.</p>
        </div>
      )}

      <footer className={styles.foot}>
        <span className={styles.number}>
          <span className={styles.numberLabel}>Badge ID</span>
          <span className={styles.numberValue}>{badge.number}</span>
        </span>
        <span className={styles.brand}>
          <CloudTimeLockup size={26} />
        </span>
      </footer>
    </article>
  );
}
