"use client";

import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Bell, BellOff, CircleCheck, Info } from "lucide-react";
import { Banner, Button, Switch } from "@/components/ui";
import { setGateAlerts, type GateAlertsSetting } from "@/actions/gate-refusals.actions";
import { BuildingWindow } from "./building-window";
import styles from "./building-windows.module.css";

type Site = GateAlertsSetting["sites"][number];

/**
 * The gate alert setting, for System Admins only (the page passes it nothing
 * for anybody else, and the action refuses them): a bell beside the building
 * picker, with a dot while the alert is on here, opening a window that turns
 * it on or off per building.
 *
 * <p>The window leads with the building on screen and says whether its gate
 * tablets send their building, since that decides whether a pop up lands in
 * the right place, then lists every other building with a gate. A switch
 * saves at once; other screens follow within seconds through the page's
 * pulse, and every change goes in the audit log.
 */
export function GateAlertsButton({
  sites,
  siteId,
  onChanged,
}: {
  sites: Site[];
  siteId: string;
  onChanged: (site: Site, onSince: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const here = sites.find((s) => s.id === siteId) ?? null;
  if (!here) return null;
  const on = here.onSince !== null;

  return (
    <>
      <span className={styles.iconBtn}>
        <Button
          hierarchy="secondary"
          iconOnly
          onClick={() => setOpen(true)}
          aria-label={`Gate alerts, ${on ? "on" : "off"} at ${here.name}`}
          title={`Gate alerts: ${on ? "on" : "off"} at ${here.name}`}
        >
          {on ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </Button>
        {on && <span className={styles.onDot} aria-hidden="true" />}
      </span>
      {open && <GateAlertsWindow sites={sites} here={here} onChanged={onChanged} onClose={() => setOpen(false)} />}
    </>
  );
}

function GateAlertsWindow({
  sites,
  here,
  onChanged,
  onClose,
}: {
  sites: Site[];
  here: Site;
  onChanged: (site: Site, onSince: string | null) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = sites.filter((s) => s.id !== here.id && (s.gates > 0 || s.onSince !== null));

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
      subtitle="A pop up on Live Attendance when the security gate turns away somebody with no shift today"
      icon={<Bell className="h-[18px] w-[18px]" />}
      width={600}
      foot="Shown to roles with Live Attendance Execute, such as Loss Prevention. Only people turned away after alerts are turned on show up, and every change is kept in the audit log."
      onClose={onClose}
    >
      {error && <Banner tone="error" title="Not saved" body={error} />}

      <section className={styles.hero} data-on={here.onSince !== null} aria-label={here.name}>
        <div className={styles.heroTop}>
          <span className={styles.grow}>
            <h3 className={styles.heroName} title={here.name}>
              {here.name}
            </h3>
            <span className={styles.heroState}>{stateLine(here)}</span>
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

      {others.length > 0 && (
        <section className={styles.group} aria-label="Other buildings">
          <div className={styles.groupHead}>
            Other buildings
            <span className={styles.groupCount}>
              {others.filter((s) => s.onSince !== null).length} of {others.length} on
            </span>
          </div>
          {others.map((s) => (
            <div key={s.id} className={styles.siteRow}>
              <span className={styles.grow}>
                <span className={styles.name} title={s.name}>
                  {s.name}
                </span>
                <span className={styles.sub}>
                  {s.onSince ? stateLine(s) : "Off"} · {readyShort(s)}
                </span>
              </span>
              <Switch
                size="sm"
                checked={s.onSince !== null}
                disabled={saving !== null}
                onChange={(next) => void flip(s, next)}
              />
            </div>
          ))}
        </section>
      )}
    </BuildingWindow>
  );
}

function stateLine(s: Site): string {
  return s.onSince ? `On since ${format(new Date(s.onSince), "MMM d, h:mm a")}` : "Off. Nobody gets the pop up here.";
}

function readyShort(s: Site): string {
  if (s.gates === 0) return "No gate tablets seen lately";
  if (s.sendingBuilding === s.gates) return `${s.gates} of ${s.gates} gate tablets ready`;
  return `${s.sendingBuilding} of ${s.gates} gate tablets ready`;
}

/** Whether a pop up from this building's gates lands here, in a sentence. */
function Readiness({ site }: { site: Site }) {
  if (site.gates === 0) {
    return (
      <p className={styles.ready} data-tone="neutral">
        <Info aria-hidden="true" />
        No gate tablets have scanned here in the last two days.
      </p>
    );
  }
  if (site.sendingBuilding === site.gates) {
    return (
      <p className={styles.ready} data-tone="success">
        <CircleCheck aria-hidden="true" />
        {site.gates === 1 ? "Its gate tablet sends" : `All ${site.gates} gate tablets send`} the building with every
        check, so pop ups land here.
      </p>
    );
  }
  const old = site.gates - site.sendingBuilding;
  return (
    <p className={styles.ready} data-tone="warning">
      <AlertTriangle aria-hidden="true" />
      {old} of {site.gates} gate tablets still run an app older than build 163 and do not send the building. Somebody
      they turn away may pop up in their home building instead of here.
    </p>
  );
}
