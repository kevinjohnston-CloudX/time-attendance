/**
 * CloudTime WMS bridge.
 *
 * Runs on a VM that can reach both the WMS Oracle database and the public
 * internet. Every cycle it asks CloudTime for pending jobs, answers each with
 * one read-only Oracle query, and posts the answers back. All traffic is
 * OUTBOUND from this machine; nothing connects in.
 *
 * This is the same shape as the CXT ticketing bridge already running on
 * bltix — deliberately, so there is one pattern to understand and not two. It
 * is a separate process with its own config and its own secret so that a fault
 * in one cannot stop the other: the ticketing bridge routes carrier email, and
 * this one carries payroll data.
 *
 * Config: ./config.json next to this file (see config.example.json).
 * Run once for testing:  node bridge.mjs --once
 * Check the queries only: node bridge.mjs --dry-run
 */
import oracledb from "oracledb";
import { readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = "1.0.0";
const ONCE = process.argv.includes("--once");
const DRY_RUN = process.argv.includes("--dry-run");

const config = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
const POLL_SECONDS = Math.max(15, Number(config.pollSeconds ?? 60));

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

// Older Oracle servers (before 12.1) are refused by node-oracledb's built-in
// "thin" driver with NJS-138. Pointing at an Instant Client folder switches it
// to thick mode, which supports them. Same setting the ticketing bridge uses.
if (config.oracle?.clientLibDir) {
  oracledb.initOracleClient({ libDir: config.oracle.clientLibDir });
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    const dir = join(HERE, "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `bridge-${new Date().toISOString().slice(0, 7)}.log`), line + "\n");
  } catch {
    /* logging must never kill the loop */
  }
}

async function cloudtime(path, options = {}) {
  const res = await fetch(`${config.cloudTimeBaseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${config.bridgeSecret}`,
      "x-bridge-version": VERSION,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`CloudTime ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * The roster. This mirrors the translation the legacy TimeClock API has always
 * done — wmsusers.barcode -> framewrk.users.empid — which is the step CloudTime
 * was missing and the reason 10-digit badges matched nobody.
 *
 * Column aliases are quoted so Oracle preserves their case and the JSON keys
 * come back exactly as written here.
 */
const ROSTER_SQL =
  'SELECT u.empid AS "empId", u.usersid AS "usersId", wu.barcode AS "barcode", ' +
  'u.username AS "name", u.active AS "active" ' +
  "FROM framewrk.users u " +
  "JOIN wmsusers wu ON wu.userid = u.usersid";

/**
 * The schedule window.
 *
 * PLACEHOLDER — the column names here are a guess. Confirm them against the
 * real DAILYWORKERSCHEDULE before trusting this; `node bridge.mjs --dry-run`
 * prints what the query returns without sending anything anywhere.
 */
const SCHEDULE_SQL =
  'SELECT s.scheduleid AS "scheduleId", u.empid AS "empId", u.usersid AS "usersId", ' +
  's.workdate AS "workDate", s.starttime AS "startTime", s.endtime AS "endTime", ' +
  's.mealminutes AS "mealMinutes" ' +
  "FROM dailyworkerschedule s " +
  "JOIN framewrk.users u ON u.usersid = s.usersid " +
  "WHERE s.workdate >= TO_DATE(:dateFrom, 'YYYY-MM-DD') " +
  "  AND s.workdate <  TO_DATE(:dateTo, 'YYYY-MM-DD')";

/**
 * Oracle refuses any write inside a read-only transaction (ORA-01456), so this
 * holds even if the bridge is ever pointed at a login that could otherwise
 * write. It has to be the first statement of the transaction; the rollback in
 * the caller ends it so the next job sees fresh data.
 */
async function beginReadOnly(conn) {
  await conn.execute("SET TRANSACTION READ ONLY");
}

/** Oracle hands back DATE columns as JS Dates; CloudTime wants YYYY-MM-DD. */
function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/**
 * A shift time as HH:mm. The column may be a DATE, a string, or minutes past
 * midnight depending on how it was defined, so anything unrecognised becomes
 * null rather than a guess — a wrong shift time is worse than a missing one.
 */
function toHhmm(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  const text = String(value).trim();
  if (!text) return null;
  const clock = text.match(/^(\d{1,2}):(\d{2})/);
  if (clock) return `${clock[1].padStart(2, "0")}:${clock[2]}`;
  if (/^\d{1,4}$/.test(text)) {
    const minutes = Number(text);
    if (minutes >= 0 && minutes < 1440) {
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Job handlers                                                        */
/* ------------------------------------------------------------------ */

async function handleRosterSync(conn) {
  await beginReadOnly(conn);
  const r = await conn.execute(ROSTER_SQL);

  const employees = (r.rows ?? []).map((row) => ({
    empId: row.empId === null || row.empId === undefined ? "" : String(row.empId).trim(),
    usersId: row.usersId === null || row.usersId === undefined ? null : String(row.usersId).trim(),
    barcode: row.barcode === null || row.barcode === undefined ? null : String(row.barcode).trim(),
    name: row.name === null || row.name === undefined ? null : String(row.name).trim(),
    // Oracle spells "active" in several ways depending on the column type.
    isActive: !["0", "N", "FALSE", "INACTIVE"].includes(String(row.active ?? "").trim().toUpperCase()),
  })).filter((e) => e.empId);

  return { employees };
}

async function handleSchedulePull(conn, payload) {
  const dateFrom = payload?.dateFrom;
  const dateTo = payload?.dateTo;
  if (!dateFrom || !dateTo) throw new Error("schedule.pull payload needs dateFrom and dateTo");

  await beginReadOnly(conn);
  const r = await conn.execute(SCHEDULE_SQL, { dateFrom, dateTo });

  const schedules = (r.rows ?? [])
    .map((row) => ({
      scheduleId: String(row.scheduleId ?? "").trim(),
      empId: String(row.empId ?? "").trim(),
      usersId: row.usersId === null || row.usersId === undefined ? null : String(row.usersId).trim(),
      workDate: toIsoDate(row.workDate),
      startTime: toHhmm(row.startTime),
      endTime: toHhmm(row.endTime),
      mealMinutes:
        row.mealMinutes === null || row.mealMinutes === undefined ? null : Number(row.mealMinutes),
      isWorkday: true,
    }))
    // A row with no date or no employee cannot be placed on anybody's calendar.
    .filter((s) => s.empId && s.workDate && s.scheduleId);

  return { schedules };
}

const HANDLERS = {
  "roster.sync": handleRosterSync,
  "schedule.pull": handleSchedulePull,
};

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

async function withConnection(work) {
  const conn = await oracledb.getConnection({
    user: config.oracle.user,
    password: config.oracle.password,
    connectString: config.oracle.connectString,
  });
  try {
    return await work(conn);
  } finally {
    // Ends the read-only transaction so the next job sees fresh data.
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    try {
      await conn.close();
    } catch {
      /* ignore */
    }
  }
}

async function runOnce() {
  const { jobs } = await cloudtime("/api/bridge/jobs");
  if (!jobs?.length) {
    log("no pending jobs");
    return;
  }
  log(`collected ${jobs.length} job(s)`);

  for (const job of jobs) {
    const handler = HANDLERS[job.kind];
    if (!handler) {
      log(`job ${job.id}: unknown kind ${job.kind}`);
      await cloudtime(`/api/bridge/jobs/${job.id}`, {
        method: "POST",
        body: JSON.stringify({ error: `bridge does not handle kind ${job.kind}` }),
      });
      continue;
    }

    try {
      const started = Date.now();
      const result = await withConnection((conn) => handler(conn, job.payload));
      const rows = result.employees?.length ?? result.schedules?.length ?? 0;
      log(`job ${job.id} (${job.kind}): ${rows} rows in ${Date.now() - started}ms`);

      const answer = await cloudtime(`/api/bridge/jobs/${job.id}`, {
        method: "POST",
        body: JSON.stringify({ result }),
      });
      log(
        `job ${job.id} applied: status=${answer.status} applied=${answer.applied} ` +
          `skipped=${answer.skipped} rejected=${answer.rejected}`,
      );
    } catch (err) {
      const message = String(err?.message ?? err);
      log(`job ${job.id} (${job.kind}) FAILED: ${message}`);
      // Report the failure so the job does not sit PENDING and be collected
      // again on the next pass, failing identically forever.
      try {
        await cloudtime(`/api/bridge/jobs/${job.id}`, {
          method: "POST",
          body: JSON.stringify({ error: message.slice(0, 2000) }),
        });
      } catch (reportErr) {
        log(`job ${job.id}: could not report failure: ${String(reportErr?.message ?? reportErr)}`);
      }
    }
  }
}

async function dryRun() {
  log("dry run: querying Oracle, sending nothing");
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 7);
  const to = new Date(today);
  to.setDate(to.getDate() + 28);

  const roster = await withConnection((conn) => handleRosterSync(conn));
  log(`roster.sync -> ${roster.employees.length} rows`);
  console.log(JSON.stringify(roster.employees.slice(0, 3), null, 2));

  try {
    const schedules = await withConnection((conn) =>
      handleSchedulePull(conn, {
        dateFrom: from.toISOString().slice(0, 10),
        dateTo: to.toISOString().slice(0, 10),
      }),
    );
    log(`schedule.pull -> ${schedules.schedules.length} rows`);
    console.log(JSON.stringify(schedules.schedules.slice(0, 3), null, 2));
  } catch (err) {
    log(`schedule.pull FAILED (expected until the SQL is corrected): ${String(err?.message ?? err)}`);
  }
}

async function main() {
  log(`CloudTime bridge ${VERSION} starting (poll ${POLL_SECONDS}s)`);

  if (DRY_RUN) {
    await dryRun();
    return;
  }

  for (;;) {
    try {
      await runOnce();
    } catch (err) {
      // A failed cycle is logged and retried. The queue is durable, so nothing
      // is lost by simply trying again on the next pass.
      log(`cycle failed: ${String(err?.message ?? err)}`);
    }
    if (ONCE) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

main().catch((err) => {
  log(`fatal: ${String(err?.message ?? err)}`);
  process.exit(1);
});
