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
const VERSION = "1.1.0";
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
  const ctype = res.headers.get("content-type") ?? "";
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`CloudTime ${path} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  // A 200 carrying HTML is the interesting failure: Vercel's deployment-
  // protection page, an error page served mid-deploy, or a cloudTimeBaseUrl
  // that resolves to the Next.js app shell rather than the API. Left to
  // res.json() all three read as "Unexpected token '<'", which names the
  // symptom and hides every one of the causes. Seen in production on
  // 2026-09-17T17:21Z and it cost an evening to work out afterwards.
  if (!ctype.includes("json")) {
    const peek = body.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(
      `CloudTime ${path} -> HTTP ${res.status} returned ${ctype || "no content-type"}, ` +
        `not JSON. Check cloudTimeBaseUrl points at the API host and that the ` +
        `deployment is not behind an access wall. First bytes: ${peek}`,
    );
  }

  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(
      `CloudTime ${path} -> HTTP ${res.status} claimed ${ctype} but the body did not ` +
        `parse: ${String(err?.message ?? err)}. First bytes: ${body.slice(0, 200)}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/*
 * Every query below is derived from SQL that the legacy TimeClock API runs
 * against THIS SAME database in production today —
 * Wms.TimeClock.Api/Infrastructure/Wms.TimeClock.Repository.Oracle/EmployeeRepository.cs.
 * Where that file and a guess disagreed, the guess lost: those column names
 * are serving live kiosks, so they are facts rather than assumptions.
 *
 * The one thing that code cannot tell us is which columns exist that it does
 * NOT use. So `--dry-run` runs each query on its own and reports which one
 * failed and with which ORA error, rather than failing the whole pass.
 */

/**
 * The roster: who exists, what their badge is, and whether they still work here.
 *
 * <p><b>Three corrections against the legacy source.</b> The name comes from
 * `framewrk.contact`, not `users.username` — GetInfo (EmployeeRepository.cs:29-48)
 * joins contact for firstname/lastname, and that is what employees see on the
 * kiosk. "Terminated" comes from `workerschedule.terminated`, not a column on
 * users. And the barcode join is `wmsusers.userid = users.usersid`, which is
 * the exact join GetEmployeeIdByBarcode uses (EmployeeRepository.cs:225-235).
 *
 * <p><b>Why the ROW_NUMBER.</b> GetInfo ends with `order by sw.shiftid, d.id,
 * rd.rollid` and then takes only the first row — so one person demonstrably
 * can have several `workerschedule` rows. One can also hold several badges
 * (employee 105233 holds three). Without a deterministic pick, a single roster
 * pass would emit the same empId several times with different barcodes, and
 * applyRosterBatch would let the last one win — a person's badge would appear
 * to flip on every sync. Lowest usersid / lowest shift wins, stably.
 *
 * <p>The joins are LEFT on purpose, unlike GetInfo's. GetInfo is answering
 * "can this person clock in", so an employee with no workerschedule row
 * correctly returns nothing. A roster sync answering "who exists" must not
 * silently drop that person — CloudTime would never learn their barcode.
 */
const ROSTER_SQL = `
  SELECT "empId", "usersId", "barcode", "firstName", "lastName",
         "terminated", "departmentName", "shiftDescription"
  FROM (
    SELECT u.empid              AS "empId",
           u.usersid            AS "usersId",
           wu.barcode           AS "barcode",
           c.firstname          AS "firstName",
           c.lastname           AS "lastName",
           ws.terminated        AS "terminated",
           d.description        AS "departmentName",
           sw.shiftdescription  AS "shiftDescription",
           ROW_NUMBER() OVER (
             PARTITION BY u.empid
             ORDER BY wu.userid, ws.shiftid, u.usersid
           ) AS rn
    FROM framewrk.users u
    JOIN framewrk.contact c       ON c.contactid = u.contactid
    LEFT JOIN wmsusers wu         ON wu.userid   = u.usersid
    LEFT JOIN workerschedule ws   ON ws.wmsuserid = u.usersid
    LEFT JOIN shiftsbywarehouse sw ON sw.shiftid  = ws.shiftid
    LEFT JOIN wmsdepartments d    ON d.id        = ws.deptid
    -- framewrk.users carries sentinel and test rows alongside real staff:
    -- empids of -1, 0 and 1 all appear. They match nobody in CloudTime and
    -- only inflate a payload that is already ~18,000 rows. Real employee
    -- numbers are six digits.
    WHERE u.empid IS NOT NULL
      AND REGEXP_LIKE(TO_CHAR(u.empid), '^[0-9]{4,}$')
  )
  WHERE rn = 1`;

/**
 * The daily schedule window.
 *
 * <p><b>This is not the table CloudTime assumed it was.</b> The previous
 * version of this query invented `scheduleid`, `usersid`, `workdate`,
 * `starttime`, `endtime` and `mealminutes`. The only production code that
 * touches `dailyworkerschedule` is one left join in GetInfo
 * (EmployeeRepository.cs:46) and it uses exactly three columns:
 *
 *     left join dailyworkerschedule dw
 *       on dw.wmsuserid = ws.wmsuserid
 *      and trunc(dw.scheduledate) = trunc(sysdate)
 *     ...  nvl(dw.active, 0) as Scheduled
 *
 * So Oracle's daily schedule is a **per-day yes/no flag**, not a per-day set
 * of times. The times live on the worker's assigned shift, in
 * `shiftsbywarehouse`, reached through `workerschedule.shiftid`. That is why
 * startTime/endTime below come from a different table than the workday flag,
 * and why mealMinutes is simply not available — nothing in the legacy code
 * reads one. A wrong meal deduction is worse than an absent one, so it stays
 * null rather than being invented.
 *
 * <p><b>The synthetic scheduleId.</b> There is no evidence of a primary key on
 * this table, and CloudTime wants a stable identifier per Oracle row. The
 * natural key is what the legacy join itself uses — the person and the date —
 * so that is what is composed here. It is stable across pulls, which is the
 * property ScheduleDay.oracleScheduleId actually needs.
 *
 * <p>`dw.wmsuserid` joins to `users.usersid`: GetInfo joins workerschedule as
 * `ws.wmsuserid = u.usersid` and then dailyworkerschedule as
 * `dw.wmsuserid = ws.wmsuserid`, so both are the same surrogate key.
 */
const SCHEDULE_SQL = `
  SELECT "scheduleId", "empId", "usersId", "workDate", "active",
         "shiftBegin", "shiftEnd", "shiftDescription"
  FROM (
    SELECT dw.wmsuserid || '-' || TO_CHAR(TRUNC(dw.scheduledate), 'YYYYMMDD') AS "scheduleId",
           u.empid                AS "empId",
           u.usersid              AS "usersId",
           TRUNC(dw.scheduledate) AS "workDate",
           NVL(dw.active, 0)      AS "active",
           sw.shiftbegin          AS "shiftBegin",
           sw.shiftend            AS "shiftEnd",
           sw.shiftdescription    AS "shiftDescription",
           ROW_NUMBER() OVER (
             PARTITION BY dw.wmsuserid, TRUNC(dw.scheduledate)
             ORDER BY ws.shiftid
           ) AS rn
    FROM dailyworkerschedule dw
    JOIN framewrk.users u          ON u.usersid   = dw.wmsuserid
    LEFT JOIN workerschedule ws    ON ws.wmsuserid = dw.wmsuserid
    LEFT JOIN shiftsbywarehouse sw ON sw.shiftid  = ws.shiftid
    WHERE dw.scheduledate >= TO_DATE(:dateFrom, 'YYYY-MM-DD')
      AND dw.scheduledate <  TO_DATE(:dateTo, 'YYYY-MM-DD')
  )
  WHERE rn = 1`;

/**
 * The latest security-gate scan per badge.
 *
 * <p>Two jobs at once, which is why it earns its own kind:
 *
 * <p>1. It is the missing input for the kiosk speedup. The "did you scan at
 * security first" rule that the tablet asks cajaapi about on every punch
 * (GET /employees/{id}/scantime) is answered in Oracle by
 * `timestationscanlog` — GetEmployeeScanTime, EmployeeRepository.cs:56-73.
 * CloudTime cannot answer a punch on its own until it holds this.
 *
 * <p>2. It seeds the gate-direction cutover. `scan_events` resolves IN/OUT by
 * alternating from a badge's previous scan, so the very first scan after
 * go-live always resolves IN regardless of where the person actually was.
 * Importing the last known scan per badge removes that one-off skew.
 *
 * <p>The `order by scanid desc` and "first row wins" shape is taken from
 * GetTimeStationScanLog (EmployeeRepository.cs:89-105) — the same row the
 * legacy API itself treats as current.
 */
const GATE_STATE_SQL = `
  SELECT "badgeId", "scanId", "scanType", "scanTime", "location", "outTime"
  FROM (
    SELECT t.badgeid  AS "badgeId",
           t.scanid   AS "scanId",
           t.scantype AS "scanType",
           t.scantime AS "scanTime",
           t.location AS "location",
           t.outtime  AS "outTime",
           ROW_NUMBER() OVER (PARTITION BY t.badgeid ORDER BY t.scanid DESC) AS rn
    FROM timestationscanlog t
    WHERE t.scantime >= SYSDATE - :days
  )
  WHERE rn = 1`;

/** Oracle hands back DATE columns as JS Dates; CloudTime wants YYYY-MM-DD. */
function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    // A TRUNC'd Oracle DATE arrives as local midnight. Reading it back with
    // getFullYear/getMonth/getDate keeps the calendar date the scheduler meant;
    // toISOString would shift it a day west of UTC.
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
      value.getDate(),
    ).padStart(2, "0")}`;
  }
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/** A full instant, for rows where the time of day matters (gate scans). */
function toIsoInstant(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text || null;
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

function text(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/* ------------------------------------------------------------------ */
/* Job handlers                                                        */
/* ------------------------------------------------------------------ */

async function handleRosterSync(conn) {
  const r = await conn.execute(ROSTER_SQL);

  const employees = (r.rows ?? [])
    .map((row) => {
      const first = text(row.firstName) ?? "";
      const last = text(row.lastName) ?? "";
      const name = `${first} ${last}`.trim();
      return {
        empId: text(row.empId) ?? "",
        usersId: text(row.usersId),
        barcode: text(row.barcode),
        name: name || null,
        departmentName: text(row.departmentName),
        // `terminated` is Oracle's column and counts up from 0; CloudTime
        // wants the opposite polarity. Absent (no workerschedule row) is NOT
        // read as terminated — that would mark half the roster as leavers.
        isActive:
          row.terminated === null || row.terminated === undefined
            ? true
            : Number(row.terminated) === 0,
      };
    })
    .filter((e) => e.empId);

  return { employees };
}

async function handleSchedulePull(conn, payload) {
  const dateFrom = payload?.dateFrom;
  const dateTo = payload?.dateTo;
  if (!dateFrom || !dateTo) throw new Error("schedule.pull payload needs dateFrom and dateTo");

  const r = await conn.execute(SCHEDULE_SQL, { dateFrom, dateTo });

  const schedules = (r.rows ?? [])
    .map((row) => ({
      scheduleId: text(row.scheduleId),
      empId: text(row.empId) ?? "",
      usersId: text(row.usersId),
      workDate: toIsoDate(row.workDate),
      // Oracle's daily schedule is a workday flag; the times come from the
      // assigned shift, so they describe the shift rather than an override.
      isWorkday: Number(row.active ?? 0) !== 0,
      startTime: toHhmm(row.shiftBegin),
      endTime: toHhmm(row.shiftEnd),
      shiftDescription: text(row.shiftDescription),
      mealMinutes: null,
    }))
    // A row with no date or no employee cannot be placed on anybody's calendar.
    .filter((s) => s.empId && s.workDate && s.scheduleId);

  return { schedules };
}

/** Default lookback for the gate-state pull, in days. */
const GATE_STATE_DAYS = 14;

async function handleGateStatePull(conn, payload) {
  const days = Math.min(Math.max(Number(payload?.days ?? GATE_STATE_DAYS) || GATE_STATE_DAYS, 1), 90);
  const r = await conn.execute(GATE_STATE_SQL, { days });

  const scans = (r.rows ?? [])
    .map((row) => ({
      badgeId: text(row.badgeId) ?? "",
      scanId: text(row.scanId),
      // The legacy gate writes the literal strings "IN" and "OUT".
      scanType: (text(row.scanType) ?? "").toUpperCase() || null,
      scanTime: toIsoInstant(row.scanTime),
      location: row.location === null || row.location === undefined ? null : Number(row.location),
      outTime: toIsoInstant(row.outTime),
    }))
    .filter((s) => s.badgeId && s.scanTime);

  return { scans };
}

const HANDLERS = {
  "roster.sync": handleRosterSync,
  "schedule.pull": handleSchedulePull,
  "gatestate.pull": handleGateStatePull,
};

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

/**
 * Opens a connection, puts it in a read-only transaction, and hands it to the
 * caller.
 *
 * <p><b>The read-only transaction is opened here, not in each handler.</b> It
 * used to be the handler's job, which meant the protection held only as long
 * as every future handler remembered to ask for it — a new job kind could drop
 * the guarantee by simply not calling it, and nothing would fail loudly.
 * Oracle refuses any write inside a read-only transaction (ORA-01456), so
 * putting it on the connection makes that true for every query this process
 * will ever run, including ones nobody has written yet.
 */
async function withConnection(work) {
  const conn = await oracledb.getConnection({
    user: config.oracle.user,
    password: config.oracle.password,
    connectString: config.oracle.connectString,
  });
  try {
    // Must be the first statement of the transaction.
    await conn.execute("SET TRANSACTION READ ONLY");
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
      const rows =
        result.employees?.length ?? result.schedules?.length ?? result.scans?.length ?? 0;
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

/**
 * Queries Oracle and prints what came back. Sends nothing anywhere.
 *
 * <p>Each query runs independently and its failure is caught, because the
 * useful output of a dry run on a database nobody here can inspect is
 * "which of these three is wrong, and what did Oracle call the column" —
 * which is exactly what is lost if the first failure aborts the rest.
 */
async function dryRun() {
  log("dry run: querying Oracle, sending nothing");

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 7);
  const to = new Date(today);
  to.setDate(to.getDate() + 28);

  const probes = [
    {
      name: "roster.sync",
      run: () => withConnection((conn) => handleRosterSync(conn)),
      count: (r) => r.employees.length,
      sample: (r) => r.employees.slice(0, 3),
    },
    {
      name: "schedule.pull",
      run: () =>
        withConnection((conn) =>
          handleSchedulePull(conn, {
            dateFrom: toIsoDate(from),
            dateTo: toIsoDate(to),
          }),
        ),
      count: (r) => r.schedules.length,
      sample: (r) => r.schedules.slice(0, 3),
    },
    {
      name: "gatestate.pull",
      run: () => withConnection((conn) => handleGateStatePull(conn, { days: GATE_STATE_DAYS })),
      count: (r) => r.scans.length,
      sample: (r) => r.scans.slice(0, 3),
    },
  ];

  let failures = 0;
  for (const probe of probes) {
    try {
      const result = await probe.run();
      log(`${probe.name} -> ${probe.count(result)} rows`);
      console.log(JSON.stringify(probe.sample(result), null, 2));
    } catch (err) {
      failures++;
      // An ORA-00904 here names the column Oracle does not have, which is the
      // single most useful line this whole script can print.
      log(`${probe.name} FAILED: ${String(err?.message ?? err)}`);
    }
  }

  log(
    failures
      ? `dry run finished with ${failures} failing quer${failures === 1 ? "y" : "ies"} — fix the SQL before running for real`
      : "dry run finished: all queries returned",
  );
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
