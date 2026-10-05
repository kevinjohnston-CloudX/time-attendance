"use client";

import { useEffect, useState } from "react";
import { Tablet as TabletIcon, Zap } from "lucide-react";
import { Banner, Button, EmptyState } from "@/components/ui";
import { getSiteTablets } from "@/actions/tablets.actions";
import type { BuildingTablets, Tablet } from "@/lib/presence/tablets.service";
import type { DeviceAlert } from "@/lib/devices/check-in";
import { BuildingWindow } from "./building-window";
import styles from "./tablets-window.module.css";

/**
 * Every tablet at the building on Live Attendance, for loss prevention and
 * System Admins, built around one question: which are working, and which
 * need somebody.
 *
 * <p>Two panes, so nothing is ever folded away: the building's tablets on
 * the left, grouped by what needs doing (attention first, then working, then
 * the ones waiting for the app update), and the chosen tablet's whole picture
 * on the right. That picture leads with how it is in one sentence, then what
 * to do about it when there is something, then three readings drawn like the
 * tablet's own status bar (battery, Wi-Fi, scans today), then the rest as
 * plain label and value pairs. Tablets on an app too old to report are
 * listed from their scans and say exactly what they need.
 *
 * <p>Asks again every minute while open; a tablet checks in every five.
 */

const REFRESH_MS = 60_000;

type Health = "ATTENTION" | "WORKING" | "UPDATE";

/** A working tablet's problem, and what to do about it, in words. */
const ALERT_TEXT: Partial<Record<DeviceAlert, { short: string; todo: string }>> = {
  UNPLUGGED: {
    short: "Unplugged",
    todo: "It is running on battery. Plug it back into power.",
  },
  QUEUE_STUCK: {
    short: "Scans not going out",
    todo: "Scans are waiting on the tablet and not reaching CloudTime. Check its Wi-Fi.",
  },
  CAMERA_OFF: {
    short: "Camera blocked",
    todo: "Camera access is turned off in the tablet's settings, so no photo is taken at a scan.",
  },
  CLOCK_OFF: {
    short: "Clock is wrong",
    todo: "Its clock is off, so scan times may be wrong. Turn on automatic time in the tablet's settings.",
  },
  LOW_STORAGE: {
    short: "Storage almost full",
    todo: "Its storage is almost full. Ask IT to clear it before it stops saving scans.",
  },
  DIRTY_BUILD: {
    short: "Test build",
    todo: "It is running a test copy of the app. Ask IT to install the regular build.",
  },
};

const issues = (t: Tablet) =>
  t.alerts.map((a) => ALERT_TEXT[a]).filter((x): x is { short: string; todo: string } => Boolean(x));
function healthOf(t: Tablet): Health {
  if (t.status === "NOT_REPORTING") return "UPDATE";
  if (t.status === "OFFLINE" || issues(t).length > 0) return "ATTENTION";
  return "WORKING";
}
const GROUPS: { health: Health; title: string }[] = [
  { health: "ATTENTION", title: "Need attention" },
  { health: "WORKING", title: "Working" },
  { health: "UPDATE", title: "Waiting for the app update" },
];
const kind = (t: Tablet) => (t.stream === "SECURITY" ? "Security gate" : "Time clock");

export function TabletsWindow({
  siteId,
  siteName,
  onClose,
}: {
  siteId: string;
  siteName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<BuildingTablets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Bumped by Try again, to ask straight away.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const r = await getSiteTablets({ siteId });
        if (dead) return;
        setNow(Date.now());
        if (r.success) {
          setData(r.data);
          setError(null);
        } else {
          setError(
            r.error === "FORBIDDEN"
              ? "Your role does not include the tablet list."
              : "The tablet list did not load. Check your connection and try again.",
          );
        }
      } catch {
        if (!dead) setError("The tablet list did not load. Check your connection and try again.");
      }
    };
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      dead = true;
      window.clearInterval(t);
    };
  }, [siteId, attempt]);

  const tz = data?.site.timezone ?? "America/New_York";
  const ordered = data?.tablets ?? [];

  const subtitle = data
    ? `${siteName}, ${ordered.length} ${ordered.length === 1 ? "tablet" : "tablets"}, updated ${whenLabel(data.checkedAt, tz, now)}`
    : siteName;

  return (
    <BuildingWindow
      title="Tablets"
      subtitle={subtitle}
      icon={<TabletIcon className="h-[18px] w-[18px]" />}
      width={940}
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
              <Button hierarchy="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            }
          />
        </div>
      ) : !data ? (
        <div className={styles.panes} aria-label="Loading tablets">
          <div className={styles.list}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={styles.skeleton} style={{ height: 52, marginBottom: 6 }} />
            ))}
          </div>
          <div className={styles.detail}>
            <div className={styles.skeleton} style={{ height: 52, width: "60%" }} />
            <div className={styles.skeleton} style={{ height: 96 }} />
            <div className={styles.skeleton} style={{ height: 180 }} />
          </div>
        </div>
      ) : ordered.length === 0 ? (
        <div className={styles.center}>
          <EmptyState
            icon={<TabletIcon className="h-6 w-6" />}
            title="No tablets at this building"
            body="A tablet shows here once it scans a badge or checks in with CloudTime."
          />
        </div>
      ) : (
        <TabletsPanes data={data} now={now} chosen={chosen} onChoose={setChosen} />
      )}
    </BuildingWindow>
  );
}

/** The two panes with a loaded list: what the window shows once it has data. */
export function TabletsPanes({
  data,
  now,
  chosen,
  onChoose,
}: {
  data: BuildingTablets;
  now: number;
  chosen: string | null;
  onChoose: (key: string) => void;
}) {
  const tz = data.site.timezone;
  const byName = (a: Tablet, b: Tablet) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  const groups = GROUPS.map((g) => ({
    ...g,
    tablets: data.tablets.filter((t) => healthOf(t) === g.health).sort(byName),
  })).filter((g) => g.tablets.length > 0);
  const ordered = groups.flatMap((g) => g.tablets);
  // The most urgent one is open to start with, and stays chosen across refreshes.
  const current = ordered.find((t) => t.key === chosen) ?? ordered[0] ?? null;
  return (
    <div className={styles.panes}>
      <nav className={`ta-scroll ${styles.list}`} aria-label="Tablets">
        {groups.map((g) => (
          <section key={g.health} className={styles.group} aria-label={g.title}>
            <div className={styles.groupHead}>
              <span>{g.title}</span>
              <span className={styles.groupCount}>{g.tablets.length}</span>
            </div>
            <div role="listbox" aria-label={g.title}>
              {g.tablets.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="option"
                  aria-selected={current?.key === t.key}
                  className={styles.pick}
                  onClick={() => onChoose(t.key)}
                >
                  <span className={styles.light} data-health={healthOf(t)} aria-hidden="true" />
                  <span className={styles.pickName} title={t.name}>
                    {t.name}
                  </span>
                  <span className={styles.pickLine}>{shortLine(t, tz, now)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </nav>
      {current && <TabletDetail key={current.key} t={current} tz={tz} now={now} />}
    </div>
  );
}

/** The list's one line under a name: the kind of tablet, or what is wrong. */
function shortLine(t: Tablet, tz: string, now: number): string {
  if (t.status === "OFFLINE") return `Not responding since ${whenLabel(t.lastSeenAt, tz, now)}`;
  const issue = issues(t)[0];
  if (t.status === "ONLINE" && issue) return issue.short;
  return kind(t);
}

function TabletDetail({ t, tz, now }: { t: Tablet; tz: string; now: number }) {
  const health = healthOf(t);
  const reporting = t.status !== "NOT_REPORTING";

  const state =
    t.status === "OFFLINE" ? (
      <>
        <strong>Not responding</strong> since {whenLabel(t.lastSeenAt, tz, now)}
      </>
    ) : t.status === "NOT_REPORTING" ? (
      <>
        <strong>Waiting for the app update</strong>
        {t.lastScanAt ? `, last scan ${whenLabel(t.lastScanAt, tz, now)}` : ""}
      </>
    ) : (
      <>
        <strong>Working</strong>, checked in {agoLabel(t.lastSeenAt, now)}
      </>
    );

  return (
    <section className={`ta-scroll ${styles.detail}`} aria-label={t.name}>
      <header>
        <h3 className={styles.name}>{t.name}</h3>
        <p className={styles.state} data-health={health}>
          <span className={styles.light} data-health={health} aria-hidden="true" />
          <span>{state}</span>
        </p>
      </header>

      {t.status === "OFFLINE" && (
        <p className={styles.todo} data-tone="error">
          It has not checked in with CloudTime since {whenLabel(t.lastSeenAt, tz, now)}. Check that it is switched on,
          plugged in and connected to the Wi-Fi, and that the CloudTime app is open. The readings below are from its
          last check in.
        </p>
      )}
      {t.status === "ONLINE" &&
        issues(t).map((i) => (
          <p key={i.short} className={styles.todo} data-tone="warning">
            {i.todo}
          </p>
        ))}
      {!reporting && (
        <p className={styles.todo} data-tone="neutral">
          This tablet runs app build {t.appVersion ?? "unknown"}, which cannot report its battery, Wi-Fi or connection.
          Ask IT to install build 163 or later and everything shows here within five minutes.
          {t.stream === "SECURITY"
            ? " Until then, somebody this gate turns away may pop up in their home building instead of this one."
            : ""}
        </p>
      )}

      {reporting && (
        <div className={styles.readings} data-stale={t.status === "OFFLINE" || undefined}>
          <BatteryReading t={t} />
          <WifiReading t={t} />
          <div className={styles.reading}>
            <span className={styles.readingLabel}>Scans today</span>
            <span className={styles.readingMain}>
              {t.scansToday === null ? "None" : t.scansToday.toLocaleString("en-US")}
            </span>
            <span className={styles.readingSub}>
              {t.lastScanAt ? `Last scan ${whenLabel(t.lastScanAt, tz, now)}` : "None in the last 7 days"}
            </span>
          </div>
        </div>
      )}

      <dl className={styles.facts}>
        {reporting ? (
          <>
            <Fact
              label="Waiting to send"
              value={
                t.pending === null
                  ? "Not reported"
                  : t.pending === 0
                    ? "Nothing, every scan has gone out"
                    : `${t.pending} ${t.pending === 1 ? "scan" : "scans"}${t.oldestPendingSec ? `, the oldest ${minutesLabel(t.oldestPendingSec)}` : ""}`
              }
            />
            <Fact label="Used as" value={kind(t)} />
            <Fact
              label="Last heard from"
              value={`${whenLabel(t.lastSeenAt, tz, now)} (${agoLabel(t.lastSeenAt, now)})`}
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
            <Fact
              label="App"
              value={`Build ${t.appVersion ?? "unknown"}${t.appOpen === false ? ", in the background" : t.appOpen ? ", open on screen" : ""}`}
            />
            <Fact
              label="Device"
              value={[t.model, t.android ? `Android ${t.android}` : null].filter(Boolean).join(", ") || "Not reported"}
            />
            <Fact label="Last restart" value={t.bootedAt ? whenLabel(t.bootedAt, tz, now) : "Not reported"} />
            {t.serial && <Fact label="Serial number" value={t.serial} />}
            {t.assetTag && <Fact label="Asset tag" value={t.assetTag} />}
          </>
        ) : (
          <>
            <Fact label="Used as" value={kind(t)} />
            <Fact
              label="Last scan"
              value={t.lastScanAt ? whenLabel(t.lastScanAt, tz, now) : "None in the last 7 days"}
            />
            <Fact label="App" value={`Build ${t.appVersion ?? "unknown"}`} />
          </>
        )}
      </dl>
    </section>
  );
}

function BatteryReading({ t }: { t: Tablet }) {
  const pct = t.batteryPct;
  const level = pct === null ? "high" : pct < 20 ? "low" : pct < 40 ? "mid" : "high";
  const sub =
    pct === null
      ? "Not reported"
      : t.charging
        ? t.plugged === "USB"
          ? "Charging on USB"
          : "Charging"
        : t.plugged === "NONE"
          ? "Unplugged, on battery"
          : "Plugged in, not charging";
  return (
    <div className={styles.reading}>
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

function WifiReading({ t }: { t: Tablet }) {
  if (t.network && t.network !== "WIFI") {
    return (
      <div className={styles.reading}>
        <span className={styles.readingLabel}>Connection</span>
        <span className={styles.readingMain}>
          {t.network === "ETHERNET" ? "Cable" : t.network === "CELLULAR" ? "Mobile data" : t.network}
        </span>
        <span className={styles.readingSub}>Not on Wi-Fi</span>
      </div>
    );
  }
  const w = wifiOf(t.wifiRssi);
  return (
    <div className={styles.reading}>
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
        {t.wifiName ? `On ${t.wifiName}` : "Connected to Wi-Fi"}
      </span>
    </div>
  );
}

function Fact({ label, value, meter }: { label: string; value: string; meter?: number | null }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>
        {value}
        {meter != null && (
          <span className={styles.meter} aria-hidden="true">
            <span
              style={{
                width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%`,
              }}
            />
          </span>
        )}
      </dd>
    </div>
  );
}

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
  const time = d.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (day(d) === day(new Date(now))) return time;
  if (day(d) === day(new Date(now - 86_400_000))) return `yesterday ${time}`;
  return `${d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}, ${time}`;
}
