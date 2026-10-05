"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  ChevronDown,
  Clock,
  DoorOpen,
  Plug,
  Tablet as TabletIcon,
  Wifi,
  WifiHigh,
  WifiLow,
  WifiOff,
} from "lucide-react";
import { Badge, Banner, Button, EmptyState } from "@/components/ui";
import { getSiteTablets } from "@/actions/tablets.actions";
import type { BuildingTablets, Tablet } from "@/lib/presence/tablets.service";
import type { DeviceAlert } from "@/lib/devices/check-in";
import { BuildingWindow } from "./building-window";
import styles from "./building-windows.module.css";

/**
 * Every tablet at the building on Live Attendance, for loss prevention and
 * System Admins: whether it is online, its app build, battery, Wi-Fi, and,
 * opened, everything else it reports. Tablets on an app too old to report
 * are still listed, from their scans, and say so.
 *
 * <p>Asks again every minute while open; a tablet checks in every five.
 */

const REFRESH_MS = 60_000;

const ALERT_LABEL: Partial<Record<DeviceAlert, string>> = {
  UNPLUGGED: "Unplugged",
  QUEUE_STUCK: "Scans stuck",
  CAMERA_OFF: "Camera blocked",
  CLOCK_OFF: "Clock is wrong",
  LOW_STORAGE: "Storage almost full",
  DIRTY_BUILD: "Test build",
};

export function TabletsWindow({ siteId, siteName, onClose }: { siteId: string; siteName: string; onClose: () => void }) {
  const [data, setData] = useState<BuildingTablets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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
          setError(r.error === "FORBIDDEN" ? "You do not have access to the tablet list." : "The tablets could not be loaded.");
        }
      } catch {
        if (!dead) setError("The tablets could not be loaded.");
      }
    };
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      dead = true;
      window.clearInterval(t);
    };
  }, [siteId, attempt]);

  const tablets = data?.tablets ?? [];
  const tz = data?.site.timezone ?? "America/New_York";
  const online = tablets.filter((t) => t.status === "ONLINE").length;
  const offline = tablets.filter((t) => t.status === "OFFLINE").length;
  const silent = tablets.filter((t) => t.status === "NOT_REPORTING").length;
  const attention = tablets.filter((t) => t.alerts.some((a) => ALERT_LABEL[a])).length;
  const gates = tablets.filter((t) => t.stream === "SECURITY");
  const clocks = tablets.filter((t) => t.stream !== "SECURITY");

  const subtitle = data
    ? `${siteName} · ${tablets.length} ${tablets.length === 1 ? "tablet" : "tablets"} · Updated ${whenLabel(data.checkedAt, tz, now)}`
    : siteName;

  return (
    <BuildingWindow
      title="Tablets"
      subtitle={subtitle}
      icon={<TabletIcon className="h-[18px] w-[18px]" />}
      width={920}
      foot="Tablets on app 163 or later check in every five minutes. Older ones are found from their scans and need the update to report battery and connection."
      onClose={onClose}
    >
      {error && (
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
      )}

      {!data && !error && (
        <div className="flex flex-col gap-2" aria-label="Loading tablets">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      )}

      {data && tablets.length === 0 && (
        <EmptyState
          icon={<TabletIcon className="h-6 w-6" />}
          title="No tablets at this building"
          body="A tablet shows here once it scans a badge or checks in with CloudTime."
        />
      )}

      {tablets.length > 0 && (
        <>
          <div className={styles.summary}>
            <Badge tone="success" dot>
              {online} online
            </Badge>
            {offline > 0 && (
              <Badge tone="error" dot>
                {offline} offline
              </Badge>
            )}
            {silent > 0 && (
              <Badge tone="neutral" dot>
                {silent} not reporting
              </Badge>
            )}
            {attention > 0 && (
              <Badge tone="warning" dot>
                {attention} {attention === 1 ? "needs" : "need"} attention
              </Badge>
            )}
          </div>
          {gates.length > 0 && (
            <Group title="Security gate" icon={<DoorOpen className="h-4 w-4" />} count={gates.length}>
              {gates.map((t) => (
                <TabletRow key={t.key} t={t} tz={tz} now={now} open={open === t.key} onToggle={() => setOpen(open === t.key ? null : t.key)} />
              ))}
            </Group>
          )}
          {clocks.length > 0 && (
            <Group title="Time clock" icon={<Clock className="h-4 w-4" />} count={clocks.length}>
              {clocks.map((t) => (
                <TabletRow key={t.key} t={t} tz={tz} now={now} open={open === t.key} onToggle={() => setOpen(open === t.key ? null : t.key)} />
              ))}
            </Group>
          )}
        </>
      )}
    </BuildingWindow>
  );
}

function Group({ title, icon, count, children }: { title: string; icon: ReactNode; count: number; children: ReactNode }) {
  return (
    <section className={styles.group} aria-label={title}>
      <div className={styles.groupHead}>
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--icon-tertiary)" }}>
          {icon}
        </span>
        {title}
        <span className={styles.groupCount}>
          {count} {count === 1 ? "tablet" : "tablets"}
        </span>
      </div>
      {children}
    </section>
  );
}

function TabletRow({
  t,
  tz,
  now,
  open,
  onToggle,
}: {
  t: Tablet;
  tz: string;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const reporting = t.status !== "NOT_REPORTING";
  const flags = t.alerts.map((a) => ALERT_LABEL[a]).filter((l): l is string => Boolean(l));
  const sub = reporting
    ? [t.model, t.android ? `Android ${t.android}` : null].filter(Boolean).join(" · ") || "Model not reported"
    : "Not reporting, needs app update";

  return (
    <div className={styles.tablet}>
      <button type="button" className={styles.row} aria-expanded={open} onClick={onToggle}>
        <span className={styles.who}>
          <span className={styles.dot} data-status={t.status} aria-hidden="true" />
          <span className={styles.names}>
            <span className={styles.name} title={t.name}>
              {t.name}
            </span>
            <span className={styles.sub} title={sub}>
              {sub}
            </span>
          </span>
        </span>
        <span className={styles.cell}>
          <span className={styles.cellLabel}>App</span>
          <span className={styles.cellValue} data-tone={t.appVersion && !t.sendsBuilding ? "warning" : undefined}>
            {t.appVersion ? `Build ${t.appVersion}` : <span className={styles.muted}>Unknown</span>}
          </span>
        </span>
        <span className={styles.cell}>
          <span className={styles.cellLabel}>Battery</span>
          <Battery t={t} />
        </span>
        <span className={styles.cell}>
          <span className={styles.cellLabel}>Wi-Fi</span>
          <Signal t={t} />
        </span>
        <span className={styles.status}>
          <StatusBadge t={t} />
          <span className={styles.statusWhen}>{statusWhen(t, tz, now)}</span>
        </span>
        <ChevronDown className={styles.chev} aria-hidden="true" />
      </button>
      {flags.length > 0 && (
        <div className={styles.flags}>
          {flags.map((f) => (
            <Badge key={f} tone="warning" size="sm">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {f}
            </Badge>
          ))}
        </div>
      )}
      {open && <Details t={t} tz={tz} now={now} />}
    </div>
  );
}

function StatusBadge({ t }: { t: Tablet }) {
  if (t.status === "ONLINE") return <Badge tone="success" size="sm">Online</Badge>;
  if (t.status === "OFFLINE") return <Badge tone="error" size="sm">Offline</Badge>;
  return <Badge tone="neutral" size="sm">Not reporting</Badge>;
}

function statusWhen(t: Tablet, tz: string, now: number): string {
  if (t.status === "ONLINE") return `Checked in ${agoLabel(t.lastSeenAt, now)}`;
  if (t.status === "OFFLINE") return `Last check in ${whenLabel(t.lastSeenAt, tz, now)}`;
  return t.lastScanAt ? `Last scan ${whenLabel(t.lastScanAt, tz, now)}` : "";
}

function Battery({ t }: { t: Tablet }) {
  if (t.batteryPct === null) return <span className={`${styles.cellValue} ${styles.muted}`}>Not reported</span>;
  const pct = t.batteryPct;
  const Icon = t.charging ? BatteryCharging : pct >= 70 ? BatteryFull : pct >= 30 ? BatteryMedium : BatteryLow;
  const tone = !t.charging && pct < 20 ? "error" : !t.charging && pct < 40 ? "warning" : "success";
  return (
    <span className={styles.cellValue} data-tone={tone}>
      <Icon aria-hidden="true" />
      {pct}%
      {t.charging ? (
        <span style={{ color: "var(--text-tertiary)" }}>charging</span>
      ) : t.plugged && t.plugged !== "NONE" ? (
        <span title="Plugged in, not charging" style={{ display: "inline-flex" }}>
          <Plug aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}

/** Wi-Fi strength in words, from the signal the tablet reports. */
function signalWord(rssi: number | null): { word: string; tone?: string; Icon: typeof Wifi } {
  if (rssi === null) return { word: "Connected", Icon: Wifi };
  if (rssi >= -55) return { word: "Strong", tone: "success", Icon: Wifi };
  if (rssi >= -67) return { word: "Good", tone: "success", Icon: WifiHigh };
  if (rssi >= -75) return { word: "Fair", tone: "warning", Icon: WifiLow };
  return { word: "Weak", tone: "error", Icon: WifiLow };
}

function Signal({ t }: { t: Tablet }) {
  if (t.status === "NOT_REPORTING") return <span className={`${styles.cellValue} ${styles.muted}`}>Not reported</span>;
  if (t.status === "OFFLINE") {
    return (
      <span className={styles.cellValue} data-tone="error">
        <WifiOff aria-hidden="true" />
        No contact
      </span>
    );
  }
  if (t.network && t.network !== "WIFI") {
    return <span className={styles.cellValue}>{t.network === "ETHERNET" ? "Cable" : t.network === "CELLULAR" ? "Mobile data" : t.network}</span>;
  }
  const s = signalWord(t.wifiRssi);
  return (
    <span className={styles.cellValue} data-tone={s.tone}>
      <s.Icon aria-hidden="true" />
      {s.word}
    </span>
  );
}

function Details({ t, tz, now }: { t: Tablet; tz: string; now: number }) {
  if (t.status === "NOT_REPORTING") {
    return (
      <div className={styles.details}>
        <Detail label="Last scan" value={whenLabel(t.lastScanAt, tz, now)} />
        <Detail label="App" value={t.appVersion ? `Build ${t.appVersion}` : "Unknown"} />
        {t.stream === "SECURITY" && <Detail label="Building on gate checks" value={t.sendsBuilding ? "Sent" : "Not sent"} />}
        <p className={styles.detailNote}>
          This tablet runs an app too old to report battery, connection or storage. Updating it to build 163 or later
          brings all of that here{t.stream === "SECURITY" ? ", and makes its gate alerts pop up in this building" : ""}.
        </p>
      </div>
    );
  }
  const s = signalWord(t.wifiRssi);
  return (
    <div className={styles.details}>
      <Detail label="Last check in" value={`${agoLabel(t.lastSeenAt, now)} (${whenLabel(t.lastSeenAt, tz, now)})`} />
      <Detail label="Last scan" value={t.lastScanAt ? whenLabel(t.lastScanAt, tz, now) : "None in the last 7 days"} />
      <Detail label="Scans today" value={num(t.scansToday)} />
      <Detail
        label="Waiting to send"
        value={
          t.pending === null
            ? "Not reported"
            : t.pending === 0
              ? "None"
              : `${t.pending}${t.oldestPendingSec ? `, oldest ${minutesLabel(t.oldestPendingSec)}` : ""}`
        }
      />
      <Detail label="Could not be sent" value={num(t.failed)} />
      {t.stream === "SECURITY" && (
        <Detail label="Building on gate checks" value={t.sendsBuilding ? "Sent with every check" : "Not sent (needs build 163)"} />
      )}
      <Detail
        label="Battery"
        value={
          t.batteryPct === null
            ? "Not reported"
            : `${t.batteryPct}%, ${t.charging ? "charging" : "not charging"}${plugWord(t.plugged)}${
                t.batteryTempC !== null ? `, ${Math.round(t.batteryTempC)}°C (${Math.round(t.batteryTempC * 1.8 + 32)}°F)` : ""
              }`
        }
      />
      <Detail
        label="Wi-Fi"
        value={
          t.network && t.network !== "WIFI"
            ? t.network
            : `${s.word}${t.wifiRssi !== null ? ` (${t.wifiRssi} dBm)` : ""}${t.wifiName ? ` on ${t.wifiName}` : ""}`
        }
      />
      <Detail
        label="Storage free"
        value={
          t.storageFreeMb === null
            ? "Not reported"
            : `${gb(t.storageFreeMb)}${t.storageTotalMb ? ` of ${gb(t.storageTotalMb)}` : ""}`
        }
      />
      <Detail label="CloudTime app" value={t.appOpen === null ? "Not reported" : t.appOpen ? "Open on screen" : "In the background"} />
      <Detail label="Camera" value={t.cameraOk === null ? "Not reported" : t.cameraOk ? "Allowed" : "Blocked"} />
      <Detail
        label="Clock"
        value={
          t.clockSkewSec === null
            ? "Not reported"
            : `${Math.abs(t.clockSkewSec) <= 60 ? "Correct" : `${minutesLabel(Math.abs(t.clockSkewSec))} ${t.clockSkewSec > 0 ? "ahead" : "behind"}`}${
                t.autoTime === false ? ", automatic time off" : ""
              }`
        }
      />
      <Detail label="Last restart" value={t.bootedAt ? whenLabel(t.bootedAt, tz, now) : "Not reported"} />
      <Detail label="Model" value={t.model ?? "Not reported"} />
      <Detail label="Android" value={t.android ?? "Not reported"} />
      <Detail label="Serial number" value={t.serial ?? "Not reported"} />
      {t.assetTag && <Detail label="Asset tag" value={t.assetTag} />}
      <Detail label="First seen" value={t.firstSeenAt ? whenLabel(t.firstSeenAt, tz, now) : "Not reported"} />
      {t.reinstalls > 0 && <Detail label="App reinstalled" value={`${t.reinstalls} ${t.reinstalls === 1 ? "time" : "times"}`} />}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detail}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  );
}

const num = (n: number | null) => (n === null ? "Not reported" : n.toLocaleString("en-US"));
const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const plugWord = (p: string | null) =>
  p === "AC" ? " on wall power" : p === "USB" ? " on USB" : p === "WIRELESS" ? " on a wireless charger" : p === "NONE" ? ", unplugged" : "";

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

/** "2:34 PM" today, "Yesterday 2:34 PM", else "Oct 1, 2:34 PM", in the building's time. */
function whenLabel(iso: string | null, tz: string, now: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const time = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
  if (day(d) === day(new Date(now))) return time;
  if (day(d) === day(new Date(now - 86_400_000))) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}, ${time}`;
}
