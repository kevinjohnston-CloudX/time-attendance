"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { ChevronLeft, ChevronRight, Eye, LogOut, Menu as MenuIcon, Search, X } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import { setViewAsRole, clearViewAsRole } from "@/actions/view-as.actions";
import { SegmentedControl } from "@/components/ui";
import type { WaitingItem } from "@/lib/dashboard/dashboard-data";
import { LIVE_ATTENDANCE_ONLY_HREFS } from "@/lib/constants";
import { BrandTile, CloudTimeWordmark } from "./cloudtime-logo";
import { openCommandPalette } from "./command-palette";
import { NotificationBell } from "./notification-bell";
import { HelpButton } from "@/components/support/help-button";
import { usePhoneBackState } from "./phone-back";
import { Avatar } from "./sidebar";
import {
  APPROVALS_HREF,
  ROLE_LABEL,
  activeHref,
  phoneTabs,
  visibleSections,
} from "./nav-model";
import styles from "./phone-shell.module.css";

/**
 * The phone's frame: a slim bar at the top, four pages and Menu at the
 * bottom, and the menu itself, which lists every page the sidebar does.
 *
 * <p>Drawn by the portal layout beside the desktop sidebar and top bar, and
 * shown instead of them below 768 pixels (or on a phone held sideways), by
 * the .ta-phone-only and .ta-desktop-only classes. One set of permissions
 * feeds both, so a phone can reach exactly what a computer can.
 */

/** Pages reached from Approvals, so the Approvals tab stays lit on them. */
const APPROVAL_QUEUES = ["/supervisor/leave", "/supervisor/exceptions"];

const noSubscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false);

export function PhoneTopBar({
  waiting,
  helpOffered = true,
  userPhoto = null,
}: {
  waiting: WaitingItem[];
  helpOffered?: boolean;
  userPhoto?: string | null;
}) {
  const pathname = usePathname();
  const back = usePhoneBackState();
  const { title, folded, scrolled } = useFoldingTitle(pathname);
  const home = pathname === "/dashboard";
  return (
    <div className="ta-phone-only">
      <header className={styles.top} data-scrolled={scrolled ? "true" : undefined}>
        <div className={styles.topStart}>
          {back ? (
            <button type="button" className={styles.back} onClick={back.onBack}>
              <ChevronLeft className={styles.backIcon} aria-hidden="true" />
              <span className={styles.backLabel}>{back.label}</span>
            </button>
          ) : (
            home && (
              <Link href="/dashboard" className={styles.brand} aria-label="CloudTime home">
                <span className={styles.brandTile}>
                  <BrandTile size={30} />
                </span>
                <CloudTimeWordmark size={19} />
              </Link>
            )
          )}
        </div>
        {/* The page's own title, once it has scrolled up under this bar. */}
        <div className={styles.topTitle} data-on={!back && !home && folded && title ? "true" : undefined} aria-hidden="true">
          {/* Empty while hidden, so it takes no room from the back button. */}
          {!back && !home && folded ? title : null}
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={openCommandPalette} aria-label="Search pages">
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          {helpOffered && <HelpButton variant="phone" className={styles.iconBtn} photo={userPhoto} />}
          <div className={styles.bell}>
            <NotificationBell items={waiting} />
          </div>
        </div>
      </header>
    </div>
  );
}

/**
 * The page's title, and whether it has scrolled up out of sight, so the top
 * bar can take it over as a phone app's does. Read from the page's first
 * visible h1, so no page has to report its own title.
 */
function useFoldingTitle(pathname: string) {
  const [state, setState] = useState<{ title: string | null; folded: boolean; scrolled: boolean }>({
    title: null,
    folded: false,
    scrolled: false,
  });
  useEffect(() => {
    const main = document.querySelector<HTMLElement>("main.ta-page-scroll");
    if (!main) return;
    let h1: HTMLElement | null = null;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!h1 || !h1.isConnected || h1.offsetParent === null) {
        h1 = Array.from(main.querySelectorAll<HTMLElement>("h1")).find((e) => e.offsetParent !== null) ?? null;
      }
      const title = h1?.dataset.barTitle || h1?.textContent?.trim() || null;
      const folded = h1 ? h1.getBoundingClientRect().bottom < main.getBoundingClientRect().top + 4 : false;
      const scrolled = main.scrollTop > 2;
      setState((s) => (s.title === title && s.folded === folded && s.scrolled === scrolled ? s : { title, folded, scrolled }));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const changed = () => {
      h1 = null;
      soon();
    };
    measure();
    main.addEventListener("scroll", soon, { passive: true });
    const watch = new MutationObserver(changed);
    watch.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      main.removeEventListener("scroll", soon);
      watch.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);
  return state;
}

type PhoneNavProps = {
  userName?: string | null;
  userPhoto?: string | null;
  permissions: string[];
  realRole?: string;
  viewAsRole?: string | null;
  canViewAs?: boolean;
  viewAsOptions?: { id: string; name: string }[];
  isInactive?: boolean;
  liveAttendanceOnly?: boolean;
  /** How many things wait on this person's decision, for the Approvals tab. */
  approvalsCount: number;
};

export function PhoneNav(props: PhoneNavProps) {
  const { permissions, isInactive = false, liveAttendanceOnly = false, approvalsCount } = props;
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFor, setMenuFor] = useState(pathname);

  // Opening a page from the menu closes it. Done during render rather than
  // in an effect, so the menu is gone in the same frame the page arrives.
  if (menuFor !== pathname) {
    setMenuFor(pathname);
    if (menuOpen) setMenuOpen(false);
  }

  const can = (permission?: string | string[]) => {
    if (!permission) return true;
    if (Array.isArray(permission)) return permission.some((p) => permissions.includes(p));
    return permissions.includes(permission);
  };
  const tabs = phoneTabs({ can, liveAttendanceOnly, inactive: isInactive });
  const lit = menuOpen
    ? null
    : (() => {
        const hit = activeHref(pathname, [...tabs.map((t) => t.href), ...APPROVAL_QUEUES]);
        return hit && APPROVAL_QUEUES.includes(hit) ? APPROVALS_HREF : hit;
      })();
  // A page the bar does not hold was opened from the menu: Menu says so.
  const menuLit = menuOpen || lit === null;

  return (
    <div className="ta-phone-only">
      {menuOpen && <PhoneMenu {...props} onClose={() => setMenuOpen(false)} />}
      <nav className={styles.tabs} aria-label="Main" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const on = lit === t.href;
          const count = t.approvals ? approvalsCount : 0;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={styles.tab}
              data-on={on}
              aria-current={on ? "page" : undefined}
              aria-label={count ? `${t.label}, ${count} waiting` : undefined}
              onClick={() => setMenuOpen(false)}
            >
              <span className={styles.tabIcon}>
                <t.icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.2 : 1.8} aria-hidden="true" />
                {count > 0 && <span className={styles.tabCount}>{count > 99 ? "99+" : count}</span>}
              </span>
              <span className={styles.tabLabel}>{t.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={styles.tab}
          data-on={menuLit}
          aria-expanded={menuOpen}
          aria-controls="phone-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={styles.tabIcon}>
            <MenuIcon className="h-[22px] w-[22px]" strokeWidth={menuLit ? 2.2 : 1.8} aria-hidden="true" />
          </span>
          <span className={styles.tabLabel}>Menu</span>
        </button>
      </nav>
    </div>
  );
}

/**
 * Every page this person can open, grouped as the sidebar groups them, with
 * who they are, View as, appearance and sign out. It sits above the page and
 * below the bottom bar, the way a native app's Menu tab does.
 */
function PhoneMenu({
  userName,
  userPhoto,
  permissions,
  realRole,
  viewAsRole,
  canViewAs = false,
  viewAsOptions = [],
  isInactive = false,
  liveAttendanceOnly = false,
  onClose,
}: PhoneNavProps & { onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pickingRole, setPickingRole] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sections = visibleSections({
    permissions,
    isInactive,
    onlyHrefs: liveAttendanceOnly ? LIVE_ATTENDANCE_ONLY_HREFS : undefined,
  });
  const current = activeHref(pathname, sections.flatMap((s) => s.items.map((i) => i.href)));
  const roleLabel = ROLE_LABEL[realRole ?? ""] ?? realRole ?? "";

  function viewAs(id: string | null) {
    startTransition(async () => {
      if (id) await setViewAsRole(id);
      else await clearViewAsRole();
      setPickingRole(false);
      // Home is usually where the menu already is, so arriving there would
      // not close it: close it here, so the new view is what shows.
      onClose();
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div id="phone-menu" ref={panelRef} tabIndex={-1} role="dialog" aria-label="Menu" className={styles.menu}>
      <div className={styles.menuInner}>
        <h1 className={styles.menuTitle}>Menu</h1>

        <section className={styles.card} aria-label="Your account">
          <div className={styles.account}>
            <Avatar name={userName} photo={userPhoto} size={44} />
            <div className={styles.accountText}>
              <span className={styles.accountName}>{userName ?? "Signed in"}</span>
              {viewAsRole ? (
                <span className={styles.viewingAs}>
                  <Eye className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                  <span className="truncate">Viewing as {viewAsRole}</span>
                </span>
              ) : (
                <span className={styles.accountRole}>{roleLabel}</span>
              )}
            </div>
          </div>
          {isInactive && <p className={styles.note}>Account inactive. View only.</p>}
          {canViewAs && (
            <>
              <button
                type="button"
                className={styles.row}
                aria-expanded={pickingRole}
                onClick={() => setPickingRole((v) => !v)}
              >
                <Eye className={styles.rowIcon} aria-hidden="true" />
                <span className={styles.rowLabel}>View as another role</span>
                <ChevronRight className={styles.rowChevron} data-open={pickingRole} aria-hidden="true" />
              </button>
              {pickingRole && (
                <div className={styles.roles} role="group" aria-label="View as">
                  {viewAsOptions.length === 0 && <p className={styles.note}>No roles available</p>}
                  {viewAsOptions.map((r) => {
                    const on = r.name === viewAsRole;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={styles.roleRow}
                        data-on={on}
                        disabled={isPending || on}
                        onClick={() => viewAs(r.id)}
                      >
                        <span className="min-w-0 flex-1 truncate text-left">{r.name}</span>
                        {on && <span className={styles.roleActive}>Active</span>}
                      </button>
                    );
                  })}
                  {viewAsRole && (
                    <button type="button" className={styles.roleRow} disabled={isPending} onClick={() => viewAs(null)}>
                      <X className="h-4 w-4 flex-none" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-left">Return to {roleLabel}</span>
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          <button type="button" className={styles.row} onClick={() => signOut({ callbackUrl: "/login" })}>
            <LogOut className={styles.rowIcon} aria-hidden="true" />
            <span className={styles.rowLabel}>Sign out</span>
          </button>
        </section>

        {!liveAttendanceOnly && (
          <button type="button" className={styles.search} onClick={openCommandPalette}>
            <Search className="h-5 w-5 flex-none" aria-hidden="true" />
            <span>Search pages</span>
          </button>
        )}

        {sections.map((s) => (
          <section key={s.id} aria-label={s.label}>
            <h2 className={styles.groupLabel}>{s.label}</h2>
            <div className={styles.card}>
              {s.items.map((item) => {
                const on = current === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={styles.row}
                    data-on={on}
                    aria-current={on ? "page" : undefined}
                    onClick={() => on && onClose()}
                  >
                    <item.icon className={styles.rowIcon} aria-hidden="true" />
                    <span className={styles.rowLabel}>{item.label}</span>
                    <ChevronRight className={styles.rowChevron} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        <section aria-label="Appearance">
          <h2 className={styles.groupLabel}>Appearance</h2>
          <div className={`${styles.card} ${styles.cardPadded}`}>
            <ThemeChoice />
          </div>
        </section>
      </div>
    </div>
  );
}

function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();
  if (!hydrated) return <div style={{ height: 36 }} aria-hidden />;
  return (
    <SegmentedControl
      ariaLabel="Appearance"
      fullWidth
      value={theme ?? "system"}
      onChange={setTheme}
      items={[
        { value: "system", label: "Automatic" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
}
