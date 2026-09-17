# CloudTime WMS bridge

Reads the WMS Oracle database on behalf of CloudTime. All traffic is outbound
from the VM; nothing connects in, and no port needs opening.

This is the same shape as the CXT ticketing bridge already running on bltix,
deliberately — one pattern to understand rather than two. It is a **separate
process** with its own config and its own secret, so a fault in one cannot stop
the other. The ticketing bridge routes carrier email; this one carries payroll
data, and neither should be able to take the other down.

## What it does

Every cycle (default 60s):

1. `GET /api/bridge/jobs` — collect pending work
2. Run one read-only Oracle query per job
3. `POST /api/bridge/jobs/<id>` — hand back the answer

Three job kinds:

| kind | what it returns | cadence |
|---|---|---|
| `roster.sync` | every employee with their barcode, name, department and terminated flag | every 15 min |
| `schedule.pull` | `dailyworkerschedule` rows for a date window, with the shift's times | every 15 min |
| `gatestate.pull` | the latest `timestationscanlog` row per badge | once a day |

CloudTime queues the jobs on a cron. A job nobody collects simply waits, so the
bridge being down **delays** a sync rather than failing one.

`gatestate.pull` is a seed, not a feed: it only ever writes for a badge that has
no security scan in CloudTime at all. That is what stops the first gate scan
after go-live being forced to resolve IN regardless of which way the person was
actually walking.

## Where the SQL comes from

Every query is derived from SQL the legacy TimeClock API runs against this same
database in production today —
`Wms.TimeClock.Api/Infrastructure/Wms.TimeClock.Repository.Oracle/EmployeeRepository.cs`.
Those column names are serving live kiosks, so they are facts rather than
guesses, and where an earlier guess disagreed with them the guess lost.

Two consequences worth knowing before reading the queries:

- **Oracle's daily schedule is a yes/no flag, not a set of times.** The only
  production reference to `dailyworkerschedule` is one left join in `GetInfo`
  and it uses three columns: `wmsuserid`, `scheduledate`, `active`. Shift times
  live in `shiftsbywarehouse`, reached through `workerschedule.shiftid`. So a
  schedule row's start/end describe the person's assigned shift, and
  `mealMinutes` has no Oracle source at all and stays null.
- **One person can have several `workerschedule` rows and several badges.**
  `GetInfo` orders by shift and takes the first row, which is how we know. Every
  query therefore picks one row per person deterministically with `ROW_NUMBER`,
  so a sync cannot make somebody's badge appear to flip back and forth.

## One direction only

The Oracle connection is a **read-only standby** (`WMS_STBY`), and the bridge
opens every connection with `SET TRANSACTION READ ONLY` so this holds even if it
is ever pointed at a login that could write. That happens in `withConnection`,
not in each handler — a future job kind cannot drop the guarantee by forgetting
to ask for it.

CloudTime therefore cannot push schedule changes back to WMS. A schedule edited
in CloudTime is marked `LOCAL_EDIT` and stays there; the next pull will not
overwrite it, and if Oracle's value has also changed the row is flagged
`CONFLICT` for a human. Getting a change into WMS needs a separate route.

## Install

Node 20+ and an Oracle Instant Client on the box.

```powershell
cd C:\cloudtime-bridge
npm install
copy config.example.json config.json
notepad config.json
```

Fill in:

- `cloudTimeBaseUrl` — the CloudTime host
- `bridgeSecret` — must match `BRIDGE_SECRET` in CloudTime's environment
  variables exactly. A mismatch gives 401; an unset value on the CloudTime side
  gives 503 (the endpoints are off, never open)
- `oracle.connectString` — e.g. `10.11.0.13:1521/WMS_STBY`
- `oracle.clientLibDir` — the Instant Client folder, for thick mode. Required
  for Oracle servers older than 12.1, which the thin driver refuses with
  NJS-138. **Windows paths need doubled backslashes** — this file is JSON and
  the bridge parses it as its first act.

### Check it before running it

```powershell
node bridge.mjs --dry-run
```

Queries Oracle and prints what it found. Sends nothing anywhere. Each of the
three queries runs independently and reports its own failure, so an `ORA-00904`
names the one column Oracle does not have instead of aborting the whole pass.

**Do this first, and read the sample rows.** The queries are derived from live
legacy SQL, but no one here can see the database: confirm that `roster.sync`
returns roughly the headcount you expect, that `schedule.pull` returns non-zero
rows with sane `startTime`/`endTime`, and that `gatestate.pull` returns IN/OUT
values rather than nulls.

Then one real cycle:

```powershell
node bridge.mjs --once
```

### Scheduled task

```powershell
powershell -ExecutionPolicy Bypass -File .\install-cloudtime-bridge.ps1
```

Registers `CloudTime-wms-bridge` to start at boot as SYSTEM and restart if it
dies, and restricts `config.json` to SYSTEM and Administrators — it holds the
Oracle password and the bridge secret in plain text, the same as the ticketing
bridge's config does. The installer validates `config.json` first, so a
malformed file fails at install time rather than as a silent boot restart loop.

Uninstall: same script with `-Uninstall`.

## Checking on it

- `bridge_agents` in CloudTime — `lastSeenAt` for `cloudtime-wms`. A queue
  nobody is collecting from looks exactly like a quiet queue; this is what
  tells them apart.
- `sync_runs` — one row per applied batch, with counts and per-row detail.
- `bridge_jobs` — `PENDING` means not yet collected, `FAILED` carries the
  reason. Jobs not collected within 90 minutes are failed automatically so a
  restarted bridge starts on current data rather than a backlog of stale
  windows.
- `logs/bridge-YYYY-MM.log` next to the script.

## Rotating the secret

Change `BRIDGE_SECRET` in CloudTime, mirror it in `config.json`, then restart:

```powershell
Stop-ScheduledTask CloudTime-wms-bridge; Start-ScheduledTask CloudTime-wms-bridge
```

There is no overlap window — the bridge gets 401s between the two changes, and
jobs queued in that gap are reaped after 90 minutes. Rotate at a quiet hour.
