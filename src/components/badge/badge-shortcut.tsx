import Link from "next/link";
import { ChevronRight, QrCode } from "lucide-react";
import styles from "./badge-shortcut.module.css";

/**
 * The way to the badge from Home on a phone: the app opens on Home, so the
 * badge is one tap away when someone reaches the door. Phones only; a
 * computer has My Badge in the sidebar.
 */
export function BadgeShortcut() {
  return (
    // The phone-only switch shows its element as display: contents, so it
    // wraps the link rather than sitting on it.
    <div className="ta-phone-only">
      <Link href="/badge" className={styles.shortcut}>
      <span className={styles.tile} aria-hidden="true">
        <QrCode className={styles.icon} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>My Badge</span>
        <span className={styles.line}>Show your code at the door</span>
      </span>
      <ChevronRight className={styles.chevron} aria-hidden="true" />
      </Link>
    </div>
  );
}
