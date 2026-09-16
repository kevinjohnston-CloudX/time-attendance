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

Two job kinds:

| kind | what it returns |
|---|---|
| `roster.sync` | every employee with their barcode, from `framewrk.users` joined to `wmsusers` |
| `schedule.pull` | `dailyworkerschedule` rows for a date window |

CloudTime queues the jobs on a 15-minute cron. A job nobody collects simply
waits, so the bridge being down **delays** a sync rather than failing one.

## One direction only

The Oracle connection is a **read-only standby** (`WMS_STBY`), and the bridge
opens every transaction with `SET TRANSACTION READ ONLY` so this holds even if
it is ever pointed at a login that could write.

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
  NJS-138

### Check it before running it

```powershell
node bridge.mjs --dry-run
```

Queries Oracle and prints what it found. Sends nothing anywhere. Use this to
confirm the SQL before any data reaches CloudTime.

> **The `schedule.pull` SQL is a placeholder.** The `dailyworkerschedule`
> column names in `bridge.mjs` are a guess and `--dry-run` will most likely
> fail on it. Correct them against the real table first. `roster.sync` mirrors
> what the legacy TimeClock API has always done and should work as written.

Then one real cycle:

```powershell
node bridge.mjs --once
```

### Scheduled task

```powershell
schtasks /create /tn "CloudTime Bridge" /sc onstart /ru SYSTEM ^
  /tr "node C:\cloudtime-bridge\bridge.mjs"
```

Unlike the PowerShell approach, there is nothing account-scoped here — the
secrets live in `config.json`, so the task can run as any account that can read
that file. Restrict the file's ACL accordingly; it holds the Oracle password in
plain text, the same as the ticketing bridge's config does.

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
