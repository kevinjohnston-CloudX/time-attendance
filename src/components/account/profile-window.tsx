"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { CreditCard, FileText, IdCard, KeyRound, Printer, UserRound, X } from "lucide-react";
import { Banner, Button, Input } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { IdBadge } from "@/components/badge/id-badge";
import { ID_PAPER_BODY, ID_PAPER_LABEL, printIdBadge, type IdBadgePaper } from "@/components/badge/print-id-badge";
import { useRouter } from "@/components/layout/navigation-progress";
import { loadMyProfile } from "@/actions/profile.actions";
import { changeOwnPassword } from "@/actions/password.actions";
import type { MyProfile } from "@/lib/account/my-profile.service";
import frame from "@/components/presence/export-window.module.css";
import styles from "./profile-window.module.css";

const NOT_ON_FILE = "Not on file";

function initials(name: string | null): string {
  const parts = (name ?? "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** A calendar date (YYYY-MM-DD) in words, read the same in every time zone. */
function dateWords(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Cell({
  label,
  value,
  loading,
  children,
}: {
  label: string;
  value?: string | null;
  /** Still loading: a quiet bar where the value will be, so nothing moves when it lands. */
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.cell}>
      <dt className={styles.cellLabel}>{label}</dt>
      <dd className={styles.cellValue} data-empty={!loading && !children && !value ? true : undefined} title={value ?? undefined}>
        {loading ? <span className={styles.wait} style={{ width: "62%", height: 14 }} /> : (children ?? value ?? NOT_ON_FILE)}
      </dd>
    </div>
  );
}

/**
 * My profile: the signed in person's own record, their badge and their
 * password, in one window. Opened from the name card at the foot of the menu
 * (straight away, or through the account menu for a role that has View as),
 * and from "My profile" in the phone menu.
 *
 * <p>The Export window's frame. One fixed shape: the details card on the left
 * and the badge on the right, in every state, so changing the password swaps
 * what the card holds and never the size of the window. Read only; HR
 * corrects what is on file.
 */
export function ProfileWindow({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const windowRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<"details" | "password">("details");
  const badgeRef = useRef<HTMLDivElement>(null);
  const [paperMenu, setPaperMenu] = useState(false);
  const print = (paper: IdBadgePaper) => {
    setPaperMenu(false);
    const card = badgeRef.current?.querySelector("article");
    if (card instanceof HTMLElement) printIdBadge(card, paper);
  };

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const fetchProfile = useCallback(
    () =>
      loadMyProfile()
        .then((r) => (r.success ? setProfile(r.data) : setLoadError(r.message)))
        .catch(() => setLoadError("Your profile could not be opened. Try again.")),
    [],
  );
  const load = () => {
    setLoadError(null);
    void fetchProfile();
  };

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  // Focus, Escape and handing focus back, as every window here does. Escape
  // on the password form goes back to the details rather than closing.
  const viewRef = useRef(view);
  const paperRef = useRef(paperMenu);
  useEffect(() => {
    viewRef.current = view;
    paperRef.current = paperMenu;
  }, [view, paperMenu]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    windowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (paperRef.current) setPaperMenu(false);
      else if (viewRef.current === "password") setView("details");
      else closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (!paperMenu) return;
    const away = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest?.("[data-paper-menu]")) setPaperMenu(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [paperMenu]);

  useEffect(() => {
    if (view === "password") document.getElementById("profile-current-password")?.focus();
  }, [view]);

  const openPassword = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setFailure(null);
    setView("password");
  };

  async function submitPassword(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    setFailure(null);
    if (next !== confirm) {
      setFailure("The new passwords do not match.");
      return;
    }
    setSaving(true);
    const result = await changeOwnPassword(current, next, confirm).catch(() => null);
    if (!result?.success) {
      setSaving(false);
      setFailure(result?.message ?? "The password could not be changed. Try again.");
      return;
    }
    // Every sign in has already ended on the server: leave now, with the reason.
    await signOut({ redirect: false });
    router.push("/login?changed=1");
  }

  const p = profile;
  const e = p?.employee ?? null;
  const photo = p?.badge?.photo ?? null;
  const passwordView = view === "password";
  const filled = current && next && confirm;

  return (
    <Overlay className={`${frame.scrim} ta-sheet-scrim`} onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div
        ref={windowRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-window-title"
        className={`${frame.window} ta-sheet ${styles.window}`}
      >
        <header className={frame.head}>
          <span className={frame.glyph} aria-hidden="true">
            {passwordView ? <KeyRound /> : <UserRound />}
          </span>
          <span className={frame.titles}>
            <h2 id="profile-window-title" className={`${frame.title} truncate`}>
              {passwordView ? "Change password" : "My profile"}
            </h2>
            <span className={`${frame.subtitle} truncate`}>
              {passwordView ? "The password you sign in to CloudTime with" : "Your details, badge and sign in"}
            </span>
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className={`${frame.body} ${styles.body}`}>
          {loadError && (
            <Banner
              tone="error"
              title="Your profile could not be opened"
              body={loadError}
              actions={
                <Button hierarchy="secondary" size="sm" onClick={load}>
                  Try again
                </Button>
              }
            />
          )}

          <div className={styles.panes}>
            {/* ── The details, or the password form in the same card ── */}
            <section className={`${frame.card} ${styles.card}`} aria-label={passwordView ? "Change password" : "Details"} aria-busy={!p && !loadError}>
              {passwordView ? (
                <form method="post" action="" onSubmit={submitPassword} className={styles.passwordForm}>
                  <div className={styles.section}>
                    <Input
                      id="profile-current-password"
                      type="password"
                      label="Current password"
                      autoComplete="current-password"
                      value={current}
                      onChange={(ev) => setCurrent(ev.target.value)}
                      required
                    />
                  </div>
                  <div className={styles.section}>
                    <Input
                      id="profile-new-password"
                      type="password"
                      label="New password"
                      autoComplete="new-password"
                      value={next}
                      onChange={(ev) => setNext(ev.target.value)}
                      required
                      minLength={8}
                      hint="At least 8 characters, with an uppercase letter, a number and a symbol."
                    />
                    <Input
                      id="profile-confirm-password"
                      type="password"
                      label="Confirm new password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(ev) => setConfirm(ev.target.value)}
                      required
                    />
                    {failure && <Banner tone="error" body={failure} />}
                  </div>
                  {/* Enter in any field submits, as on the sign in page. */}
                  <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
                </form>
              ) : (
                <>
                  <div className={styles.hero}>
                    <span className={styles.photo} aria-hidden="true">
                      {photo ? (
                        // A signed link to the private bucket: next/image would proxy and cache it.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo} alt="" />
                      ) : p ? (
                        <span>{initials(p.name)}</span>
                      ) : null}
                    </span>
                    <span className={styles.heroText}>
                      {p ? (
                        <>
                          <span className={styles.name} title={p.name ?? undefined}>
                            {p.name ?? p.workEmail ?? p.personalEmail ?? "Signed in"}
                          </span>
                          <span className={styles.heroLine} title={e?.jobTitle ?? undefined}>
                            {e ? e.jobTitle ?? "No job title on file" : "No employee record is linked to this sign in"}
                          </span>
                          {e?.building && <span className={styles.heroMeta}>{e.building}</span>}
                        </>
                      ) : (
                        <>
                          <span className={styles.wait} style={{ width: 180, height: 22 }} />
                          <span className={styles.wait} style={{ width: 140, height: 16 }} />
                        </>
                      )}
                    </span>
                    {e && !e.active && <span className={styles.pill}>Not active</span>}
                  </div>

                  <div className={styles.section}>
                    <h3 className={styles.sectionLabel}>Contact</h3>
                    <dl className={styles.grid}>
                      <Cell label="Work email" value={p?.workEmail} loading={!p} />
                      <Cell label="Personal email" value={p?.personalEmail} loading={!p} />
                      {(!p || e) && (
                        <>
                          <Cell label="Phone" value={e?.phone} loading={!p}>
                            {e?.phone && e.otherPhone ? (
                              <span className={styles.lines}>
                                <span className="truncate">{e.phone}</span>
                                <span className="truncate">{e.otherPhone}</span>
                              </span>
                            ) : undefined}
                          </Cell>
                          <Cell label="Address" value={e?.address[0] ?? null} loading={!p}>
                            {e && e.address.length > 1 ? (
                              <span className={styles.lines}>
                                {e.address.map((line) => (
                                  <span key={line} className="truncate" title={line}>
                                    {line}
                                  </span>
                                ))}
                              </span>
                            ) : undefined}
                          </Cell>
                        </>
                      )}
                    </dl>
                  </div>

                  {(!p || e) && (
                    <div className={styles.section}>
                      <h3 className={styles.sectionLabel}>Employment</h3>
                      <dl className={styles.grid}>
                        <Cell label="Employee ID" value={e?.employeeId} loading={!p} />
                        <Cell label="Department" value={e?.department} loading={!p} />
                        <Cell label="Supervisor" value={e?.supervisor} loading={!p} />
                        <Cell label="Hire date" value={dateWords(e?.hireDate ?? null)} loading={!p} />
                      </dl>
                    </div>
                  )}

                  <div className={styles.section}>
                    <h3 className={styles.sectionLabel}>Sign in</h3>
                    <dl className={styles.grid}>
                      {/* Only older administrator accounts have a username; everyone else signs in with an email. */}
                      {p?.username && <Cell label="Username" value={p.username} />}
                      <Cell
                        label="Sign in method"
                        value={p ? (p.hasPassword ? "Email and password" : "Google account") : undefined}
                        loading={!p}
                      />
                      <Cell label="Password" value={p && !p.hasPassword ? "Managed by Google" : undefined} loading={!p}>
                        {p?.hasPassword ? (
                          <Button
                            hierarchy="secondary"
                            size="sm"
                            leadingIcon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={openPassword}
                          >
                            Change password
                          </Button>
                        ) : undefined}
                      </Cell>
                    </dl>
                  </div>
                </>
              )}
            </section>

            {/* ── The badge, as the door reads it ── */}
            <aside className={`${frame.rail} ${styles.rail}`} aria-label="My badge">
              <div ref={badgeRef} className={styles.badgeWell}>
                {!p ? (
                  <span className={styles.badgeWait} />
                ) : p.badge ? (
                  <span className={styles.badgeScale}>
                    <IdBadge badge={p.badge} />
                  </span>
                ) : (
                  <span className={styles.noBadge}>
                    <IdCard className="h-6 w-6" aria-hidden="true" />
                    <span className={styles.noBadgeTitle}>No badge on this account</span>
                    <span className={styles.noBadgeBody}>Badges belong to employee records. HR can link one to your sign in.</span>
                  </span>
                )}
              </div>
              <div className={styles.railFoot}>
                <p className={styles.railNote}>
                  {p?.badge?.active ? "Hold the code up to the scanner." : p?.badge ? "This badge does not open doors." : ""}
                </p>
                {p?.badge && (
                  <span className={styles.printAnchor} data-paper-menu>
                    <Button
                      hierarchy="secondary"
                      size="sm"
                      leadingIcon={<Printer className="h-3.5 w-3.5" aria-hidden="true" />}
                      aria-haspopup="menu"
                      aria-expanded={paperMenu}
                      onClick={() => setPaperMenu((v) => !v)}
                    >
                      Print badge
                    </Button>
                    {paperMenu && (
                      <span role="menu" aria-label="Print on" className={styles.paperMenu}>
                        <span className={styles.paperLabel}>Print on</span>
                        {(["letter", "card"] as const).map((paper) => (
                          <button key={paper} type="button" role="menuitem" className={styles.paperRow} onClick={() => print(paper)}>
                            <span className={styles.paperIcon} aria-hidden="true">
                              {paper === "letter" ? <FileText /> : <CreditCard />}
                            </span>
                            <span className={styles.paperText}>
                              <span className={styles.paperTitle}>{ID_PAPER_LABEL[paper]}</span>
                              <span className={styles.paperBody}>{ID_PAPER_BODY[paper]}</span>
                            </span>
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </aside>
          </div>
        </div>

        <footer className={frame.foot}>
          <span className={frame.footHint} aria-live="polite">
            {passwordView
              ? "You will be signed out on every device, then sign in again with the new password."
              : "To correct any of these details, contact HR."}
          </span>
          <span className="ta-sheet-actions contents">
            {passwordView ? (
              <>
                <Button hierarchy="tertiary" onClick={() => setView("details")} disabled={saving}>
                  Back
                </Button>
                <Button hierarchy="primary" onClick={() => void submitPassword()} disabled={saving || !filled} pending={saving}>
                  {saving ? "Changing…" : "Change password"}
                </Button>
              </>
            ) : (
              <Button hierarchy="secondary" onClick={onClose}>
                Close
              </Button>
            )}
          </span>
        </footer>
      </div>
    </Overlay>
  );
}
