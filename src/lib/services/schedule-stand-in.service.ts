import { db } from "@/lib/db";
import {
  SyncTally,
  failSyncRun,
  finishSyncRun,
  startSyncRun,
} from "@/lib/services/sync-run.service";
import {
  LOOKBACK_DAYS,
  addDays,
  pickStandIns,
  planStandIn,
  siteClock,
  type StandInStep,
} from "@/lib/services/schedule-stand-in";

/**
 * Writes and removes stand-in schedules, one building at a time. The rules are
 * in schedule-stand-in.ts; this is only the reading and writing.
 *
 * <p>Run from the enqueue cron every five minutes, which runs on Vercel and
 * not on the bridge, so a stand-in is still written on a morning the bridge
 * itself is down. Every pass is safe to repeat: a stand-in is only written for
 * somebody with no row today, and only stand-in rows are ever removed.
 */

/**
 * A schedule pull still RUNNING after this long has crashed rather than being
 * in progress. A healthy pull takes 20 to 30 seconds, the hourly wide one two
 * minutes.
 */
const PULL_RUNNING_MINUTES = 10;

const AGENT = "cloudtime-stand-in";

export type StandInSite = {
  site: string;
  today: string;
  step: StandInStep;
  oracleRows: number;
  usualPeople: number;
  written: number;
  removed: number;
};

/** SCHEDULE_STAND_IN=off stops new stand-ins. Removing them never stops. */
export function standInEnabled(): boolean {
  return (process.env.SCHEDULE_STAND_IN ?? "").trim().toLowerCase() !== "off";
}

export async function runScheduleStandIn(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ skipped?: "PULL_RUNNING"; sites: StandInSite[] }> {
  // Never alongside a pull. Mid-pull, Oracle's day is half applied: a
  // building can look as if Oracle had not sent it (and get stand-ins the pull
  // then collides with), or look arrived while the rest of its rows are still
  // to come (and lose stand-ins Oracle was about to confirm). The next pass is
  // five minutes away.
  const pulling = await db.syncRun.findFirst({
    where: {
      tenantId,
      kind: "SCHEDULE_PULL",
      status: "RUNNING",
      startedAt: { gte: new Date(now.getTime() - PULL_RUNNING_MINUTES * 60_000) },
    },
    select: { id: true },
  });
  if (pulling) return { skipped: "PULL_RUNNING", sites: [] };

  const sites = await db.site.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, timezone: true },
    orderBy: { name: "asc" },
  });

  const enabled = standInEnabled();
  const tally = new SyncTally();
  const results: StandInSite[] = [];
  for (const site of sites) {
    results.push(await standInSite(tenantId, site, now, enabled, tally));
  }

  // Recorded only when something changed, so the sync log shows the mornings
  // this happened and not one empty row every five minutes.
  if (results.some((r) => r.written > 0 || r.removed > 0)) {
    const runId = await startSyncRun(tenantId, "SCHEDULE_STAND_IN", AGENT);
    try {
      await finishSyncRun(runId, tally);
    } catch (err) {
      await failSyncRun(runId, err);
    }
  }

  return { sites: results };
}

async function standInSite(
  tenantId: string,
  site: { id: string; name: string; timezone: string },
  now: Date,
  enabled: boolean,
  tally: SyncTally,
): Promise<StandInSite> {
  const { today, hour } = siteClock(now, site.timezone);
  const workDate = new Date(`${today}T00:00:00.000Z`);
  const here = { siteId: site.id };

  const [oracleRows, standInRows, recent] = await Promise.all([
    // Rows Oracle has sent at least once, whatever CloudTime did with them
    // after: a person loss prevention added before Oracle's day arrived is a
    // CONFLICT row now, and Oracle did send it.
    db.scheduleDay.count({
      where: { tenantId, workDate, oracleSyncedAt: { not: null }, employee: here },
    }),
    db.scheduleDay.count({
      where: { tenantId, workDate, source: "STAND_IN", employee: here },
    }),
    // Never from stand-ins: a guess must not become the basis of the next one.
    db.scheduleDay.findMany({
      where: {
        tenantId,
        workDate: {
          gte: new Date(`${addDays(today, -LOOKBACK_DAYS)}T00:00:00.000Z`),
          lte: new Date(`${addDays(today, -1)}T00:00:00.000Z`),
        },
        isWorkday: true,
        source: { not: "STAND_IN" },
        employee: { siteId: site.id, isActive: true, terminatedAt: null },
      },
      select: {
        employeeId: true,
        workDate: true,
        shiftId: true,
        startTime: true,
        endTime: true,
        mealMinutes: true,
      },
    }),
  ]);

  const usual = new Set(recent.map((d) => d.employeeId));
  const step = planStandIn({ hour, oracleRows, usualPeople: usual.size, standInRows, enabled });
  const result: StandInSite = {
    site: site.name,
    today,
    step,
    oracleRows,
    usualPeople: usual.size,
    written: 0,
    removed: 0,
  };

  if (step === "STAND_IN") {
    const rowsToday = await db.scheduleDay.findMany({
      where: { workDate, employeeId: { in: [...usual] } },
      select: { employeeId: true },
    });
    const picks = pickStandIns(
      recent.map((d) => ({ ...d, workDate: d.workDate.toISOString().slice(0, 10) })),
      new Set(rowsToday.map((r) => r.employeeId)),
    );
    if (picks.length > 0) {
      // skipDuplicates: a row that appeared since the read above (a pull, a
      // person added by hand) wins, and this simply does not write that one.
      const written = await db.scheduleDay.createMany({
        data: picks.map((p) => ({
          tenantId,
          employeeId: p.employeeId,
          workDate,
          isWorkday: true,
          shiftId: p.shiftId,
          startTime: p.startTime,
          endTime: p.endTime,
          mealMinutes: p.mealMinutes,
          source: "STAND_IN" as const,
          syncState: "SYNCED" as const,
        })),
        skipDuplicates: true,
      });
      result.written = written.count;
      if (written.count > 0) {
        tally.applied += written.count;
        tally.note(
          "STAND_IN_WRITTEN",
          site.name,
          `${written.count} people for ${today}: Oracle had sent ${oracleRows} of the usual ` +
            `${usual.size} by ${String(hour).padStart(2, "0")}:00 here`,
        );
        console.warn(
          `[schedule-stand-in] ${site.name} ${today}: Oracle's day has not arrived; ` +
            `wrote ${written.count} stand-in workdays`,
        );
      }
    }
  }

  if (step === "REMOVE_EXTRAS") {
    const extras = await db.scheduleDay.findMany({
      where: { tenantId, workDate, source: "STAND_IN", employee: here },
      select: { id: true, employee: { select: { wmsId: true } } },
    });
    // The source is checked again in the delete itself: a row the pull turned
    // into Oracle's since the read above is Oracle's now and stays.
    const removed = await db.scheduleDay.deleteMany({
      where: { id: { in: extras.map((e) => e.id) }, source: "STAND_IN" },
    });
    result.removed = removed.count;
    if (removed.count > 0) {
      tally.applied += removed.count;
      tally.note(
        "STAND_IN_REMOVED",
        site.name,
        `${removed.count} for ${today}: Oracle sent the day (${oracleRows} rows) without them`,
      );
      for (const e of extras) {
        tally.note("NOT_IN_ORACLE", e.employee.wmsId ?? "-", `${site.name} ${today}`);
      }
      console.warn(
        `[schedule-stand-in] ${site.name} ${today}: Oracle's day arrived; ` +
          `removed ${removed.count} stand-ins it did not confirm`,
      );
    }
  }

  return result;
}
