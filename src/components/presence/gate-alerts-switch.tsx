"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Bell } from "lucide-react";
import { Badge, Banner, Switch } from "@/components/ui";
import { setGateAlerts, type GateAlertsSetting } from "@/actions/gate-refusals.actions";
import { BuildingWindow } from "./building-window";
import styles from "./building-windows.module.css";

type Site = GateAlertsSetting["sites"][number];

/**
 * The gate alert setting, per building, for System Admins only (the page
 * passes it nothing for anybody else, and the action refuses them). Opened
 * from the "Gate alerts on/off" chip under the Live Attendance title.
 *
 * <p>Leads with the building on screen: on or off, since when, its switch,
 * and a bar saying how many of its gate tablets send their building, since
 * that decides whether a pop up lands in the right place. Every other
 * building with a gate follows as a row with the same three things. A switch
 * saves at once; other screens follow within seconds through the page's
 * pulse, and every change goes in the audit log.
 */
export function GateAlertsWindow({
  sites,
  siteId,
  onChanged,
  onClose,
}: {
  sites: Site[];
  siteId: string;
  onChanged: (site: Site, onSince: string | null) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const here = sites.find((s) => s.id === siteId) ?? null;
  const others = sites.filter((s) => s.id !== siteId && (s.gates > 0 || s.onSince !== null));

  const flip = async (site: Site, next: boolean) => {
    if (saving) return;
    setSaving(site.id);
    setError(null);
    try {
      const r = await setGateAlerts({ siteId: site.id, on: next });
      if (r.success) onChanged(site, r.data.onSince);
      else
        setError(
          r.error === "FORBIDDEN"
            ? "Only System Admins can change gate alerts."
            : r.error === "NOT_FOUND"
              ? "That building is no longer on your list. Reload the page and try again."
              : "The change was not saved. Try again.",
        );
    } catch {
      setError("The change was not saved. Try again.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <BuildingWindow
      title="Gate alerts"
      subtitle="A pop up on Live Attendance when a security gate turns away somebody with no shift today"
      icon={<Bell />}
      width={640}
      foot="Shown to roles with Live Attendance Execute, such as Loss Prevention. Only people turned away after alerts are turned on show up, and every change is kept in the audit log."
      onClose={onClose}
    >
      {error && <Banner tone="error" title="Not saved" body={error} />}

      {here && (
        <section className={styles.hero} data-on={here.onSince !== null} aria-label={here.name}>
          <div className={styles.heroTop}>
            <span className={styles.heroText}>
              <h3 className={styles.heroName}>
                <span title={here.name}>{here.name}</span>
                <OnBadge on={here.onSince !== null} />
              </h3>
              <span className={styles.heroState}>
                {here.onSince
                  ? `Loss Prevention gets a pop up here. On since ${format(new Date(here.onSince), "MMM d, h:mm a")}.`
                  : "Nobody gets a pop up here. The gate still works and every refusal is recorded."}
              </span>
            </span>
            <Switch
              checked={here.onSince !== null}
              disabled={saving !== null}
              onChange={(next) => void flip(here, next)}
              id="gate-alerts-here"
            />
          </div>
          <Readiness site={here} />
        </section>
      )}

      {others.length > 0 && (
        <section className={styles.sitesCard} aria-labelledby="gate-others">
          <div className={styles.sitesHead}>
            <span id="gate-others" className={styles.groupLabel}>
              Other buildings with a gate
            </span>
            <span className={styles.sitesCount}>
              {others.filter((s) => s.onSince !== null).length} of {others.length} on
            </span>
          </div>
          <div className={styles.sites}>
            {others.map((s) => (
              <div key={s.id} className={styles.siteRow}>
                <span className={styles.siteText}>
                  <span className={styles.siteName}>
                    <span title={s.name}>{s.name}</span>
                    <OnBadge on={s.onSince !== null} />
                  </span>
                  <span className={styles.siteSub}>
                    {s.onSince ? `On since ${format(new Date(s.onSince), "MMM d, h:mm a")}` : readyWords(s)}
                  </span>
                </span>
                <span className={styles.siteReady} title="Gate tablets that send their building">
                  <span className={styles.track} data-size="small" data-tone={ready(s) < 1 ? "warning" : undefined}>
                    <span style={{ width: `${Math.round(ready(s) * 100)}%` }} />
                  </span>
                  {s.gates === 0 ? "No gates seen" : `${s.sendingBuilding} of ${s.gates} ready`}
                </span>
                <Switch
                  size="sm"
                  checked={s.onSince !== null}
                  disabled={saving !== null}
                  onChange={(next) => void flip(s, next)}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </BuildingWindow>
  );
}

function OnBadge({ on }: { on: boolean }) {
  return (
    <Badge tone={on ? "success" : "neutral"} size="sm">
      {on ? "On" : "Off"}
    </Badge>
  );
}

const ready = (s: Site) => (s.gates === 0 ? 0 : s.sendingBuilding / s.gates);

function readyWords(s: Site): string {
  if (s.gates === 0) return "No gate tablets have scanned here lately";
  if (s.sendingBuilding === s.gates) return "Ready: every gate tablet sends the building";
  return "Not ready yet: some gate tablets need the app update";
}

/** Whether a pop up from this building's gates lands here, as a bar and a sentence. */
function Readiness({ site }: { site: Site }) {
  const share = ready(site);
  const note =
    site.gates === 0
      ? "No gate tablets have scanned here in the last two days, so there is nothing to alert on yet."
      : site.sendingBuilding === site.gates
        ? "Every gate tablet here sends its building with each check, so pop ups land in this building."
        : `${site.gates - site.sendingBuilding} of them still run an app older than build 163 and do not send the building. Somebody they turn away may pop up in their home building instead of here.`;
  return (
    <div className={styles.ready}>
      <div className={styles.readyTop}>
        <span className={styles.readyLabel}>Gate tablets ready</span>
        <span className={styles.readyCount}>
          {site.gates === 0 ? "None seen" : `${site.sendingBuilding} of ${site.gates}`}
        </span>
      </div>
      <span className={styles.track} data-tone={share < 1 ? "warning" : undefined} aria-hidden="true">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <p className={styles.readyNote}>{note}</p>
    </div>
  );
}
