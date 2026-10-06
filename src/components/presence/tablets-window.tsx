"use client";

import { useState } from "react";
import { AlertTriangle, ArrowUpCircle, Clock, DoorOpen, Tablet as TabletIcon, WifiOff, Zap } from "lucide-react";
import { Badge, Banner, Button, EmptyState } from "@/components/ui";
import type { BuildingTablets, Tablet } from "@/lib/presence/tablets.service";
import { BuildingWindow } from "./building-window";
import { countHealth, healthOf, issuesOf, statusOf, type Health } from "./tablet-health";
import styles from "./tablets-window.module.css";

/**
 * Every tablet at the building on Live Attendance, for loss prevention and
 * System Admins, built around one question: which are working, and which
 * need somebody. Opened from the tablets chip under the page title.
 *
 * <p>Three count tiles across the top, which also narrow the list; the
 * building's tablets on the left as cards, the ones that need somebody first;
 * the chosen tablet on the right: its name and status, what to do when there
 * is something, three readings (battery, Wi-Fi, scans today) and its details.
 * Tablets on an app too old to report are listed from their scans and say
 * exactly what they need.
 *
 * <p>The list comes from the page (useSiteTablets), so the chip and this
 * window always show the same answer.
 */

const GROUP_ORDER: Record<Health, number> = { ATTENTION: 0, WORKING: 1, OUT_OF_DATE: 2 };
const kind = (t: Tablet) => (t.stream === "SECURITY" ? "Security gate" : "Time clock");

export function TabletsWindow({
  siteName,
  data,
  error,
  onRetry,
  onClose,
}: {
  siteName: string;
  data: BuildingTablets | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [only, setOnly] = useState<Health | null>(null);
  const now = data ? new Date(data.checkedAt).getTime() : 0;

  const subtitle = data
    ? `${siteName}, ${data.tablets.length} ${data.tablets.length === 1 ? "tablet" : "tablets"}, updated ${whenLabel(data.checkedAt, data.site.timezone, now)}`
    : siteName;

  return (
    <BuildingWindow
      title="Tablets"
      subtitle={subtitle}
      icon={<TabletIcon className="h-[18px] w-[18px]" />}
      width={960}
      flush
      onClose={onClose}
    >
      {error && !data ? (
        <div className={styles.center}>
          <Banner
            tone="error"
            title="Not loaded"
            body={error}
            actions={
              <Button hierarchy="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      ) : !data ? (
        <>
          <div className={styles.tiles} aria-label="Loading tablets">
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.skeleton} style={{ height: 72 }} />
            ))}
          </div>
          <div className={styles.panes}>
            <div className={styles.list}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={styles.skeleton} style={{ height: 62, flex: "none" }} />
              ))}
            </div>
            <div className={styles.detail}>
              <div className={styles.skeleton} style={{ height: 52, width: "55%" }} />
              <div className={styles.skeleton} style={{ height: 96 }} />
              <div className={styles.skeleton} style={{ height: 160 }} />
            </div>
          </div>
        </>
      ) : data.tablets.length === 0 ? (
        <div className={styles.center}>
          <EmptyState
            icon={<TabletIcon className="h-6 w-6" />}
            title="No tablets at this building"
            body="A tablet shows here once it scans a badge or checks in with CloudTime."
          />
        </div>
      ) : (
        <TabletsBody data={data} now={now} chosen={chosen} onChoose={setChosen} only={only} onOnly={setOnly} />
      )}
    </BuildingWindow>
  );
}

/** The loaded window: the count tiles and the two panes. Split out so it can be drawn offline too. */
export function TabletsBody({
  data,
  now,
  chosen,
  onChoose,
  only,
  onOnly,
}: {
  data: BuildingTablets;
  now: number;
  chosen: string | null;
  onChoose: (key: string) => void;
  only: Health | null;
  onOnly: (h: Health | null) => void;
}) {
  const tz = data.site.timezone;
  const counts = countHealth(data.tablets);
  const sorted = [...data.tablets].sort(
    (a, b) =>
      GROUP_ORDER[healthOf(a)] - GROUP_ORDER[healthOf(b)] ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
  const shown = only ? sorted.filter((t) => healthOf(t) === only) : sorted;
  // Gates and clocks apart, as Live Attendance shows the two readers, each
  // group still with the ones that need somebody first.
  const groups = [
    { key: "gate", title: "Security gates", Icon: DoorOpen, tablets: shown.filter((t) => t.stream === "SECURITY") },
    { key: "clock", title: "Time clocks", Icon: Clock, tablets: shown.filter((t) => t.stream !== "SECURITY") },
  ].filter((g) => g.tablets.length > 0);
  const ordered = groups.flatMap((g) => g.tablets);
  // The most urgent one is open to start with, and stays chosen across refreshes.
  const current = ordered.find((t) => t.key === chosen) ?? ordered[0] ?? null;

  const tile = (h: Health, label: string, tone: string) => (
    <button
      type="button"
      className={styles.tile}
      aria-pressed={only === h}
      disabled={counts[h] === 0}
      onClick={() => onOnly(only === h ? null : h)}
      title={only === h ? "Show every tablet" : "Show only these"}
    >
      <span className={styles.tileLabel}>
        <span className={styles.dot} data-tone={counts[h] > 0 ? tone : undefined} aria-hidden="true" />
        {label}
      </span>
      <span className={styles.tileNum}>{counts[h]}</span>
    </button>
  );

  return (
    <>
      <div className={styles.tiles}>
        {tile("WORKING", "Working", "success")}
        {tile("ATTENTION", "Need attention", "error")}
        {tile("OUT_OF_DATE", "Out of date", "neutral")}
      </div>
      <div className={styles.panes}>
        <div className={`ta-scroll ${styles.list}`} aria-label="Tablets">
          {groups.map((g) => (
            <section key={g.key} className={styles.group} aria-label={g.title}>
              <h4 className={styles.groupHead}>
                <g.Icon aria-hidden="true" />
                <span>{g.title}</span>
                <span className={styles.groupCount}>{g.tablets.length}</span>
              </h4>
              <div role="listbox" aria-label={g.title} className={styles.groupList}>
                {g.tablets.map((t) => {
                  const st = statusOf(t, data.newestBuild);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="option"
                      aria-selected={current?.key === t.key}
                      className={styles.card}
                      onClick={() => onChoose(t.key)}
                    >
                      <span className={styles.cardName} title={t.name}>
                        {t.name}
                      </span>
                      <span className={styles.cardLine}>
                        <span className={styles.dot} data-tone={st.tone} aria-hidden="true" />
                        <span>
                          {t.status === "OFFLINE"
                            ? `Not responding since ${whenLabel(t.lastSeenAt, tz, now)}`
                            : st.line}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {current && <TabletDetail key={current.key} t={current} tz={tz} now={now} newest={data.newestBuild} />}
      </div>
    </>
  );
}

function StatusBadge({ t, newest }: { t: Tablet; newest: number }) {
  const st = statusOf(t, newest);
  return (
    <Badge tone={st.tone} size="sm">
      {st.label}
    </Badge>
  );
}

function TabletDetail({ t, tz, now, newest }: { t: Tablet; tz: string; now: number; newest: number }) {
  const reporting = t.status !== "NOT_REPORTING";
  const state =
    t.status === "OFFLINE"
      ? `${kind(t)}. Last heard from ${whenLabel(t.lastSeenAt, tz, now)} (${agoLabel(t.lastSeenAt, now)}).`
      : t.status === "NOT_REPORTING"
        ? `${kind(t)}. Last scan ${t.lastScanAt ? whenLabel(t.lastScanAt, tz, now) : "more than 7 days ago"}.`
        : `${kind(t)}. Checked in ${agoLabel(t.lastSeenAt, now)}.`;

  return (
    <section className={`ta-scroll ${styles.detail}`} aria-label={t.name}>
      <header className={styles.detailHead}>
        <div className={styles.nameRow}>
          <h3 className={styles.name}>{t.name}</h3>
          <StatusBadge t={t} newest={newest} />
        </div>
        <p className={styles.state}>{state}</p>
      </header>

      {t.status === "OFFLINE" && (
        <p className={styles.todo} data-tone="error">
          <WifiOff aria-hidden="true" />
          <span>
            It has not checked in with CloudTime since {whenLabel(t.lastSeenAt, tz, now)}. Check that it is switched on,
            plugged in and connected to the Wi-Fi, and that the CloudTime app is open. The readings below are from its
            last check in.
          </span>
        </p>
      )}
      {t.status === "ONLINE" &&
        issuesOf(t).map((i) => (
          <p key={i.short} className={styles.todo} data-tone="warning">
            <AlertTriangle aria-hidden="true" />
            <span>{i.todo}</span>
          </p>
        ))}
      {!reporting && t.outOfDate && (
        <p className={styles.todo} data-tone="info">
          <ArrowUpCircle aria-hidden="true" />
          <span>
            This tablet runs app build {t.appVersion ?? "unknown"}, which cannot report its battery, Wi-Fi or
            connection. Ask IT to install build {newest}, and everything shows here within five minutes.
            {t.stream === "SECURITY" && !t.sendsBuilding
              ? " Until then, somebody this gate turns away may pop up in their home building instead of this one."
              : ""}
          </span>
        </p>
      )}
      {!reporting && !t.outOfDate && (
        <p className={styles.todo} data-tone="warning">
          <AlertTriangle aria-hidden="true" />
          <span>
            It scans on build {t.appVersion}, which should report its health every five minutes, but no report has
            reached CloudTime. Ask IT to check it.
          </span>
        </p>
      )}
      {reporting && t.outOfDate && t.status === "ONLINE" && (
        <p className={styles.todo} data-tone="info">
          <ArrowUpCircle aria-hidden="true" />
          <span>
            It runs app build {t.appVersion ?? "unknown"}, and other tablets already run build {newest}. Ask IT to
            update it.
          </span>
        </p>
      )}

      {reporting && (
        <div className={styles.readings}>
          <BatteryReading t={t} asOf={t.status === "OFFLINE" ? whenLabel(t.lastSeenAt, tz, now) : null} />
          <WifiReading t={t} asOf={t.status === "OFFLINE" ? whenLabel(t.lastSeenAt, tz, now) : null} />
          <div className={styles.reading}>
            <span className={styles.readingLabel}>Scans today</span>
            <span className={styles.readingMain}>
              {t.scansToday === null ? "None" : t.scansToday.toLocaleString("en-US")}
            </span>
            <span className={styles.readingSub}>
              {t.status === "OFFLINE"
                ? `As of ${whenLabel(t.lastSeenAt, tz, now)}`
                : t.lastScanAt
                  ? `Last one ${whenLabel(t.lastScanAt, tz, now)}`
                  : "None in the last 7 days"}
            </span>
          </div>
        </div>
      )}

      {reporting ? (
        <>
          <section className={styles.section} aria-label="Connection">
            <h4 className={styles.sectionTitle}>Connection</h4>
            <dl className={styles.inset}>
              <Fact label="Last heard from" value={whenLabel(t.lastSeenAt, tz, now)} />
              <Fact
                label="Newest scan in CloudTime"
                value={t.newestInCloudTimeAt ? whenLabel(t.newestInCloudTimeAt, tz, now) : "None yet"}
              />
              <Fact
                label="Not in CloudTime yet"
                value={
                  t.notInCloudTime === null
                    ? "Not reported"
                    : t.notInCloudTime === 0
                      ? "None, all received"
                      : `${t.notInCloudTime} ${t.notInCloudTime === 1 ? "scan" : "scans"}${t.lateToCloudTime ? `, ${t.lateToCloudTime} late` : ""}`
                }
              />
              <Fact label="Waiting to send" value={waitingWords(t)} />
              <Fact
                label="Network"
                value={
                  t.network && t.network !== "WIFI"
                    ? networkWord(t.network)
                    : `${t.wifiName ?? "Wi-Fi"}${t.wifiBandGhz ? `, ${t.wifiBandGhz} GHz` : ""}`
                }
              />
            </dl>
          </section>
          <section className={styles.section} aria-label="Device">
            <h4 className={styles.sectionTitle}>Device</h4>
            <dl className={styles.inset}>
              <Fact label="Used as" value={kind(t)} />
              <Fact
                label="App"
                value={`Build ${t.appVersion ?? "unknown"}${t.appOpen === false ? ", in the background" : ""}`}
              />
              <Fact
                label="Model"
                value={
                  [t.model, t.android ? `Android ${t.android}` : null].filter(Boolean).join(", ") || "Not reported"
                }
              />
              <Fact label="Battery" value={batteryWords(t)} />
              <Fact label="Time zone" value={timeZoneWords(t)} />
              <Fact
                label="Locked to CloudTime"
                value={t.kioskLocked === null ? "Not reported" : t.kioskLocked ? "Yes" : "No, not set up as a kiosk"}
              />
              <Fact
                label="Storage"
                value={
                  t.storageFreeMb === null
                    ? "Not reported"
                    : `${gb(t.storageFreeMb)} free${t.storageTotalMb ? ` of ${gb(t.storageTotalMb)}` : ""}`
                }
                meter={t.storageFreeMb !== null && t.storageTotalMb ? 1 - t.storageFreeMb / t.storageTotalMb : null}
              />
              <Fact label="Last restart" value={t.bootedAt ? whenLabel(t.bootedAt, tz, now) : "Not reported"} />
              {t.serial ? <Fact label="Serial number" value={t.serial} /> : null}
              {t.assetTag ? <Fact label="Asset tag" value={t.assetTag} /> : null}
            </dl>
          </section>
          <details className={styles.more}>
            <summary className={styles.moreSummary}>Technical details</summary>
            <dl className={styles.inset}>
              <Fact
                label="App running for"
                value={t.appRunningSec === null ? "Not reported" : durationWords(t.appRunningSec)}
              />
              <Fact
                label="Wi-Fi link"
                value={
                  t.wifiLinkMbps === null
                    ? "Not reported"
                    : `${t.wifiLinkMbps} Mbps${t.wifiRssi !== null ? `, ${t.wifiRssi} dBm` : ""}`
                }
              />
              <Fact
                label="Storage used by"
                value={
                  t.photosMb === null && t.logsMb === null && t.cacheMb === null
                    ? "Not reported"
                    : `Photos ${mbWords(t.photosMb)}, logs ${mbWords(t.logsMb)}, cache ${mbWords(t.cacheMb)}`
                }
              />
              <Fact
                label="Last sync with Oracle"
                value={t.lastOracleSyncAt ? whenLabel(t.lastOracleSyncAt, tz, now) : "Not reported"}
              />
              <Fact
                label="App build"
                value={
                  [
                    t.appVersion ? `Build ${t.appVersion}` : null,
                    t.versionCode !== null ? `code ${t.versionCode}` : null,
                    t.gitSha,
                    t.builtAt ? `made ${whenLabel(t.builtAt, tz, now)}` : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Not reported"
                }
              />
              <Fact label="Android build" value={t.osBuild ?? "Not reported"} />
              <Fact
                label="Check ins"
                value={`${t.checkIns.toLocaleString("en-US")}${t.firstSeenAt ? `, first ${whenLabel(t.firstSeenAt, tz, now)}` : ""}`}
              />
              <Fact
                label="App reinstalled"
                value={t.reinstalls === 0 ? "Never" : `${t.reinstalls} ${t.reinstalls === 1 ? "time" : "times"}`}
              />
            </dl>
          </details>
        </>
      ) : (
        <section className={styles.section} aria-label="Device">
          <h4 className={styles.sectionTitle}>Device</h4>
          <dl className={styles.inset}>
            <Fact label="Used as" value={kind(t)} />
            <Fact label="App" value={`Build ${t.appVersion ?? "unknown"}`} />
            <Fact
              label="Last scan"
              value={t.lastScanAt ? whenLabel(t.lastScanAt, tz, now) : "None in the last 7 days"}
            />
          </dl>
        </section>
      )}
    </section>
  );
}

/**
 * `asOf` is set for a tablet that has stopped checking in: its readings are
 * then its last known ones, said so, and drawn without the all-is-well tint.
 */
function BatteryReading({ t, asOf }: { t: Tablet; asOf: string | null }) {
  const pct = t.batteryPct;
  const level = pct === null ? "high" : pct < 20 ? "low" : pct < 40 ? "mid" : "high";
  const tone = pct === null || asOf ? undefined : t.charging || pct >= 40 ? "success" : pct >= 20 ? "warning" : "error";
  const now =
    pct === null
      ? "Not reported"
      : t.charging
        ? t.plugged === "USB"
          ? "Charging on USB"
          : "Charging"
        : t.plugged === "NONE"
          ? "Unplugged, on battery"
          : "Plugged in, not charging";
  const sub = asOf && pct !== null ? `${now}, as of ${asOf}` : now;
  return (
    <div className={styles.reading} data-tone={tone}>
      <span className={styles.readingLabel}>Battery</span>
      <span className={styles.readingMain}>
        <span className={styles.battery} aria-hidden="true">
          <span className={styles.batteryFill} data-level={level} style={{ width: `${Math.max(4, pct ?? 0)}%` }} />
        </span>
        {pct === null ? "None" : `${pct}%`}
        {t.charging && <Zap className="h-4 w-4" style={{ color: "var(--icon-success)" }} aria-label="Charging" />}
      </span>
      <span className={styles.readingSub}>{sub}</span>
    </div>
  );
}

/** Wi-Fi strength in words and bars, from the signal the tablet reports. */
function wifiOf(rssi: number | null): { word: string; bars: number } {
  if (rssi === null) return { word: "Connected", bars: 3 };
  if (rssi >= -55) return { word: "Strong", bars: 4 };
  if (rssi >= -67) return { word: "Good", bars: 3 };
  if (rssi >= -75) return { word: "Fair", bars: 2 };
  return { word: "Weak", bars: 1 };
}
const networkWord = (n: string) => (n === "ETHERNET" ? "Cable" : n === "CELLULAR" ? "Mobile data" : n);

function WifiReading({ t, asOf }: { t: Tablet; asOf: string | null }) {
  // Not heard from: the honest answer now is no contact, whatever the signal
  // was at its last check in.
  if (asOf) {
    const was =
      t.network && t.network !== "WIFI" ? networkWord(t.network).toLowerCase() : wifiOf(t.wifiRssi).word.toLowerCase();
    return (
      <div className={styles.reading} data-tone="error">
        <span className={styles.readingLabel}>Connection</span>
        <span className={styles.readingMain}>
          <span className={styles.bars} aria-hidden="true">
            {[1, 2, 3, 4].map((b) => (
              <span key={b} data-on={false} />
            ))}
          </span>
          No contact
        </span>
        <span className={styles.readingSub}>
          Was {was}, as of {asOf}
        </span>
      </div>
    );
  }
  if (t.network && t.network !== "WIFI") {
    return (
      <div className={styles.reading}>
        <span className={styles.readingLabel}>Connection</span>
        <span className={styles.readingMain}>{networkWord(t.network)}</span>
        <span className={styles.readingSub}>Not on Wi-Fi</span>
      </div>
    );
  }
  const w = wifiOf(t.wifiRssi);
  return (
    <div className={styles.reading} data-tone={w.bars >= 3 ? "success" : "warning"}>
      <span className={styles.readingLabel}>Wi-Fi</span>
      <span className={styles.readingMain}>
        <span className={styles.bars} data-level={w.bars <= 2 ? "weak" : undefined} aria-hidden="true">
          {[1, 2, 3, 4].map((b) => (
            <span key={b} data-on={b <= w.bars} />
          ))}
        </span>
        {w.word}
      </span>
      <span className={styles.readingSub} title={t.wifiName ?? undefined}>
        {t.wifiName ? `On ${t.wifiName}` : "Signal strength"}
      </span>
    </div>
  );
}

function Fact({ label, value, meter }: { label: string; value: string; meter?: number | null }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>
        {meter != null && (
          <span className={styles.meter} aria-hidden="true">
            <span style={{ width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%` }} />
          </span>
        )}
        <span>{value}</span>
      </dd>
    </div>
  );
}

/** Scans, punches and photos still on the tablet, in one line. */
function waitingWords(t: Tablet): string {
  if (t.pending === null && t.photosWaiting === null) return "Not reported";
  const parts: string[] = [];
  if (t.pending) {
    parts.push(
      `${t.pending} ${t.pending === 1 ? "scan" : "scans"}${t.oldestPendingSec ? `, oldest ${minutesLabel(t.oldestPendingSec)}` : ""}`,
    );
  }
  if (t.photosWaiting) parts.push(`${t.photosWaiting} ${t.photosWaiting === 1 ? "photo" : "photos"}`);
  return parts.length ? parts.join(" and ") : "Nothing, all sent";
}

function batteryWords(t: Tablet): string {
  const health = t.batteryHealth
    ? t.batteryHealth.toUpperCase() === "GOOD"
      ? "Healthy"
      : `Rated ${t.batteryHealth.toLowerCase().replace(/_/g, " ")}`
    : null;
  const temp =
    t.batteryTempC === null ? null : `${Math.round(t.batteryTempC)}°C (${Math.round(t.batteryTempC * 1.8 + 32)}°F)`;
  return [health, temp].filter(Boolean).join(", ") || "Not reported";
}

/** "Eastern Time, set automatically", in words rather than America/New_York. */
function timeZoneWords(t: Tablet): string {
  if (!t.timeZone) return "Not reported";
  let name = t.timeZone;
  try {
    name =
      new Intl.DateTimeFormat("en-US", { timeZone: t.timeZone, timeZoneName: "longGeneric" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? t.timeZone;
  } catch {
    // An unknown zone name: show it as the tablet sent it.
  }
  const how = t.autoTimeZone === null ? "" : t.autoTimeZone ? ", set automatically" : ", set by hand";
  return `${name}${how}`;
}

function durationWords(sec: number): string {
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hr ${min % 60} min`;
  return `${Math.floor(hr / 24)} days`;
}

const mbWords = (mb: number | null) =>
  mb === null ? "unknown" : mb < 1 ? "under 1 MB" : mb >= 1024 ? gb(mb) : `${mb} MB`;

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

function minutesLabel(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} sec`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} min`;
  return `${Math.round(min / 60)} hr`;
}

function agoLabel(iso: string | null, now: number): string {
  if (!iso) return "never";
  const sec = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  return `${minutesLabel(sec)} ago`;
}

/** "2:34 PM" today, "yesterday 2:34 PM", else "Oct 1, 2:34 PM", in the building's time. */
function whenLabel(iso: string | null, tz: string, now: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const time = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
  if (day(d) === day(new Date(now))) return time;
  if (day(d) === day(new Date(now - 86_400_000))) return `yesterday ${time}`;
  return `${d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}, ${time}`;
}
