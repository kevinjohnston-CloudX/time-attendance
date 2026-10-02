import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { gateLog } from "@/lib/presence/gate-alert-log";

/**
 * Diagnostics for the gate alert: what each open Live Attendance page reports
 * about itself (see LiveAttendanceWatch and GateRefusalView in the schema).
 * Nothing on screen reads these; they exist so a pop up that did not appear
 * can be traced afterwards to which screens were watching that building, in
 * front or behind, on which deploy, and whether their checks were answering.
 *
 * <p>Every time is the server's own clock. The page sends how long ago
 * something happened rather than a time, so a browser with its clock wrong
 * cannot move anything.
 */

const ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Longer than a page could mean: a stale value from a sleeping laptop. */
const MAX_AGO_MS = 24 * 60 * 60 * 1000;

export const CLOSED_HOW = ["DISMISSED", "ADDED", "AUTO", "NEWER_TRY", "GONE", "LEFT"] as const;
export type ClosedHow = (typeof CLOSED_HOW)[number];

export type WatchEvent =
  | {
      kind: "beat";
      segmentId: string;
      screenId: string;
      siteId: string;
      visible: boolean;
      focused: boolean;
      deployId: string | null;
      pulsesOk: number;
      pulsesFailed: number;
      pulseOkAgoMs: number | null;
      pulseError: string | null;
      alertCheckAgoMs: number | null;
      alertCards: number | null;
      alertCheckError: string | null;
    }
  | {
      kind: "shown";
      viewId: string;
      screenId: string;
      siteId: string;
      refusalId: string;
      refusalLastAt: string;
      attempts: number;
      visible: boolean;
    }
  | { kind: "closed"; viewId: string; how: ClosedHow };

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(10_000, Math.floor(v))) : 0;
const ago = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_AGO_MS ? Math.floor(v) : null;
const id = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);

/** One event from the page, checked field by field, or null when it is not one. */
export function parseWatchEvent(raw: unknown): WatchEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (e.kind === "beat") {
    const segmentId = id(e.segmentId);
    const screenId = id(e.screenId);
    const siteId = id(e.siteId);
    if (!segmentId || !screenId || !siteId) return null;
    const alertCards = e.alertCards === null || e.alertCards === undefined ? null : count(e.alertCards);
    return {
      kind: "beat",
      segmentId,
      screenId,
      siteId,
      visible: e.visible === true,
      focused: e.focused === true,
      deployId: str(e.deployId, 80),
      pulsesOk: count(e.pulsesOk),
      pulsesFailed: count(e.pulsesFailed),
      pulseOkAgoMs: ago(e.pulseOkAgoMs),
      pulseError: str(e.pulseError, 60),
      alertCheckAgoMs: ago(e.alertCheckAgoMs),
      alertCards,
      alertCheckError: str(e.alertCheckError, 60),
    };
  }
  if (e.kind === "shown") {
    const viewId = id(e.viewId);
    const screenId = id(e.screenId);
    const siteId = id(e.siteId);
    const refusalId = id(e.refusalId);
    const lastAt = typeof e.refusalLastAt === "string" ? new Date(e.refusalLastAt) : null;
    if (!viewId || !screenId || !siteId || !refusalId || !lastAt || Number.isNaN(lastAt.getTime())) return null;
    return {
      kind: "shown",
      viewId,
      screenId,
      siteId,
      refusalId,
      refusalLastAt: lastAt.toISOString(),
      attempts: count(e.attempts),
      visible: e.visible === true,
    };
  }
  if (e.kind === "closed") {
    const viewId = id(e.viewId);
    const how = CLOSED_HOW.find((h) => h === e.how);
    return viewId && how ? { kind: "closed", viewId, how } : null;
  }
  return null;
}

/** The building an event is about, for the caller's own scope check. */
export function siteOfEvent(e: WatchEvent): string | null {
  return e.kind === "closed" ? null : e.siteId;
}

const isDuplicate = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * Writes one event for this viewer. The caller has checked the viewer may see
 * the event's building. Every write is scoped by company and viewer, so an id
 * from somebody else's page changes nothing.
 */
export async function recordWatchEvent(
  viewer: { tenantId: string; employeeId: string | null; alerts: boolean },
  e: WatchEvent,
): Promise<void> {
  const now = new Date();
  const { tenantId, employeeId } = viewer;
  if (e.kind === "beat") {
    const since = (ms: number | null) => (ms === null ? undefined : new Date(now.getTime() - ms));
    const latest = {
      lastBeatAt: now,
      focused: e.focused,
      alerts: viewer.alerts,
      lastPulseOkAt: since(e.pulseOkAgoMs),
      lastPulseError: e.pulseError ?? undefined,
      lastAlertCheckAt: since(e.alertCheckAgoMs),
      alertCards: e.alertCards ?? undefined,
      lastAlertCheckError: e.alertCheckError ?? undefined,
    };
    const updated = await db.liveAttendanceWatch.updateMany({
      where: { id: e.segmentId, tenantId, employeeId, screenId: e.screenId, siteId: e.siteId },
      data: { ...latest, pulsesOk: { increment: e.pulsesOk }, pulsesFailed: { increment: e.pulsesFailed } },
    });
    if (updated.count > 0) return;
    try {
      await db.liveAttendanceWatch.create({
        data: {
          ...latest,
          id: e.segmentId,
          tenantId,
          employeeId,
          screenId: e.screenId,
          siteId: e.siteId,
          visible: e.visible,
          deployId: e.deployId,
          startedAt: now,
          pulsesOk: e.pulsesOk,
          pulsesFailed: e.pulsesFailed,
        },
      });
    } catch (err) {
      // The id belongs to another viewer's row: nothing to write.
      if (!isDuplicate(err)) throw err;
    }
    return;
  }
  if (e.kind === "shown") {
    const refusal = await db.gateRefusal.findFirst({
      where: { id: e.refusalId, tenantId, siteId: e.siteId },
      select: { id: true, lastAt: true },
    });
    if (!refusal) return;
    try {
      await db.gateRefusalView.create({
        data: {
          id: e.viewId,
          tenantId,
          refusalId: refusal.id,
          siteId: e.siteId,
          employeeId,
          screenId: e.screenId,
          refusalLastAt: new Date(e.refusalLastAt),
          attempts: e.attempts,
          visible: e.visible,
          shownAt: now,
        },
      });
    } catch (err) {
      if (!isDuplicate(err)) throw err;
      return;
    }
    gateLog("shown", {
      refusal: refusal.id,
      viewer: employeeId,
      site: e.siteId,
      screen: e.screenId,
      visible: e.visible,
      // How long after the try the card reached this screen.
      afterMs: now.getTime() - new Date(e.refusalLastAt).getTime(),
    });
    return;
  }
  const closed = await db.gateRefusalView.updateMany({
    where: { id: e.viewId, tenantId, employeeId, closedAt: null },
    data: { closedAt: now, closedHow: e.how },
  });
  if (closed.count > 0) gateLog("closed on screen", { view: e.viewId, viewer: employeeId, how: e.how });
}
