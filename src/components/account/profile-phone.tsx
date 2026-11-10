"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ChevronLeft, ChevronRight, KeyRound, QrCode } from "lucide-react";
import { Banner, Button, Input } from "@/components/ui";
import {
  NOT_ON_FILE,
  PASSWORD_AFTER,
  PASSWORD_RULES,
  dateWords,
  initials,
  signInMethod,
  useMyProfile,
  usePasswordChange,
} from "./use-my-profile";
import styles from "./profile-phone.module.css";

/**
 * A screen inside the phone menu, pushed over the menu the way a phone's own
 * settings open a page: a back link naming where it goes, then a large title.
 */
export function PhoneScreen({
  back,
  onBack,
  title,
  lede,
  children,
}: {
  back: string;
  onBack: () => void;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    document.getElementById("phone-screen-back")?.focus({ preventScroll: true });
    document.getElementById("phone-menu")?.scrollTo({ top: 0 });
  }, [title]);
  return (
    <div className={styles.screen}>
      <button id="phone-screen-back" type="button" className={styles.back} onClick={onBack}>
        <ChevronLeft className={styles.backIcon} aria-hidden="true" />
        <span>{back}</span>
      </button>
      <div className={styles.titles}>
        <h1 className={styles.title}>{title}</h1>
        {lede && <p className={styles.lede}>{lede}</p>}
      </div>
      {children}
    </div>
  );
}

function Fact({ label, value, loading, lines }: { label: string; value?: string | null; loading?: boolean; lines?: string[] }) {
  const shown = lines && lines.length ? lines : value ? [value] : [];
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      {loading ? (
        <span className={styles.wait} />
      ) : shown.length ? (
        shown.map((l) => (
          <span key={l} className={styles.factValue}>
            {l}
          </span>
        ))
      ) : (
        <span className={styles.factValue} data-empty>
          {NOT_ON_FILE}
        </span>
      )}
    </div>
  );
}

/**
 * My profile on a phone and in the app: the person at the top, their badge
 * one tap away (the full screen My Badge, which keeps the screen on at the
 * door), then their details in the menu's own cards, and Change password as
 * its own screen. The same record and rules as the computer window, laid out
 * for a thumb rather than shrunk from a desk.
 */
export function PhoneProfileScreen({
  onBack,
  onPassword,
  onLeave,
}: {
  onBack: () => void;
  onPassword: () => void;
  /** The menu closes when a link leaves it for a page. */
  onLeave: () => void;
}) {
  const { profile: p, loadError, retry } = useMyProfile();
  const e = p?.employee ?? null;
  const photo = p?.badge?.photo ?? null;
  const loading = !p && !loadError;

  return (
    <PhoneScreen back="Menu" onBack={onBack} title="My profile">
      {loadError && (
        <Banner
          tone="error"
          title="Your profile could not be opened"
          body={loadError}
          actions={
            <Button hierarchy="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          }
        />
      )}

      <section className={styles.hero} aria-busy={loading}>
        <span className={styles.photo} aria-hidden="true">
          {photo ? (
            // A signed link to the private bucket: next/image would proxy and cache it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" />
          ) : p ? (
            <span>{initials(p.name)}</span>
          ) : null}
        </span>
        {p ? (
          <>
            <h2 className={styles.name}>{p.name ?? p.workEmail ?? p.personalEmail ?? "Signed in"}</h2>
            <p className={styles.heroLine}>{e ? e.jobTitle ?? "No job title on file" : "No employee record is linked to this sign in"}</p>
            {e?.building && <p className={styles.heroMeta}>{e.building}</p>}
            {e && !e.active && <span className={styles.pill}>Not active</span>}
          </>
        ) : (
          <>
            <span className={styles.wait} style={{ width: 160, height: 22 }} />
            <span className={styles.wait} style={{ width: 120, height: 16 }} />
          </>
        )}
      </section>

      {p?.badge && (
        <div className={styles.card}>
          <Link href="/badge" className={styles.row} onClick={onLeave}>
            <span className={styles.rowTile} data-tone="accent" aria-hidden="true">
              <QrCode />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>My badge</span>
              <span className={styles.rowBody}>{p.badge.active ? "Show the code at the door" : "This badge does not open doors"}</span>
            </span>
            <ChevronRight className={styles.chevron} aria-hidden="true" />
          </Link>
        </div>
      )}

      <section aria-label="Contact">
        <h3 className={styles.groupLabel}>Contact</h3>
        <div className={styles.card}>
          <Fact label="Work email" value={p?.workEmail} loading={loading} />
          <Fact label="Personal email" value={p?.personalEmail} loading={loading} />
          {(loading || e) && (
            <>
              <Fact label="Phone" lines={[e?.phone, e?.otherPhone].filter((v): v is string => !!v)} loading={loading} />
              <Fact label="Address" lines={e?.address} loading={loading} />
            </>
          )}
        </div>
      </section>

      {(loading || e) && (
        <section aria-label="Employment">
          <h3 className={styles.groupLabel}>Employment</h3>
          <div className={styles.card}>
            <Fact label="Employee ID" value={e?.employeeId} loading={loading} />
            <Fact label="Department" value={e?.department} loading={loading} />
            <Fact label="Supervisor" value={e?.supervisor} loading={loading} />
            <Fact label="Hire date" value={dateWords(e?.hireDate ?? null)} loading={loading} />
          </div>
        </section>
      )}

      <section aria-label="Sign in">
        <h3 className={styles.groupLabel}>Sign in</h3>
        <div className={styles.card}>
          {p?.username && <Fact label="Username" value={p.username} />}
          <Fact label="Sign in method" value={p ? signInMethod(p) : null} loading={loading} />
          {p?.hasPassword && (
            <button type="button" className={styles.row} onClick={onPassword}>
              <span className={styles.rowTile} aria-hidden="true">
                <KeyRound />
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowLabel}>Change password</span>
              </span>
              <ChevronRight className={styles.chevron} aria-hidden="true" />
            </button>
          )}
        </div>
      </section>

      <p className={styles.foot}>To correct any of these details, contact HR.</p>
    </PhoneScreen>
  );
}

/** Change password on a phone: its own screen, the fields at touch size, one button. */
export function PhonePasswordScreen({ onBack }: { onBack: () => void }) {
  const pw = usePasswordChange();
  return (
    <PhoneScreen back="My profile" onBack={onBack} title="Change password" lede="The password you sign in to CloudTime with">
      <form method="post" action="" onSubmit={pw.submit} className={styles.form}>
        <div className={`${styles.card} ${styles.fields}`}>
          <Input
            id="phone-current-password"
            type="password"
            label="Current password"
            autoComplete="current-password"
            value={pw.current}
            onChange={(ev) => pw.setCurrent(ev.target.value)}
            required
          />
          <Input
            id="phone-new-password"
            type="password"
            label="New password"
            autoComplete="new-password"
            value={pw.next}
            onChange={(ev) => pw.setNext(ev.target.value)}
            required
            minLength={8}
            hint={PASSWORD_RULES}
          />
          <Input
            id="phone-confirm-password"
            type="password"
            label="Confirm new password"
            autoComplete="new-password"
            value={pw.confirm}
            onChange={(ev) => pw.setConfirm(ev.target.value)}
            required
          />
        </div>
        {pw.failure && <Banner tone="error" body={pw.failure} />}
        <Button type="submit" fullWidth pending={pw.saving} disabled={pw.saving}>
          {pw.saving ? "Changing…" : "Change password"}
        </Button>
        <p className={styles.foot}>{PASSWORD_AFTER}</p>
      </form>
    </PhoneScreen>
  );
}
