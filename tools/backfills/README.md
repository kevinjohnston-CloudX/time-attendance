# One-off backfills

Both are **dry-run by default** and print what they would do. Neither writes
anything without `--apply`. Both re-run their own safety checks at apply time and
refuse rather than write if anything has changed since the dry run.

Run them from the repo root, with `.env.local` present (they read `DATABASE_URL`
the same way the app does).

## 01 — badge aliases

```
node tools/backfills/01-badge-aliases.cjs            # look
node tools/backfills/01-badge-aliases.cjs --apply    # write
```

Seeds `employee_badges` from the Oracle `wmsusers` export at
`C:\Users\cristian.rendon\Downloads\barcodes.csv`.

Oracle keeps one row per card, so a re-issued badge leaves the old row in place —
95 employee numbers in the 2026-09-21 export carry between two and four barcodes.
`employees.barcode` holds one, so the rest resolved to nobody.

**The table ships empty, so until this runs the alias lookup matches nothing and
the feature is inert.** Expect 385 cards, 0 clashes. It asserts no card is claimed
by two people before writing.

Reversible: `DELETE FROM employee_badges` — nothing else references it.

## 02 — scan attribution

```
node tools/backfills/02-scan-attribution.cjs            # look
node tools/backfills/02-scan-attribution.cjs --apply    # write
```

Sets `employeeId` on 926 historical `scan_events` rows from 2026-09-15 to 09-19
that were recorded before `roster-sync` learned those barcodes. 267 people, one
badge each, zero ambiguous.

Sets `employeeId` and nothing else. `outcome` stays `NO_EMPLOYEE` and `direction`
stays `UNKNOWN` on purpose: both are true statements about what happened at the
time, `roster-sync.service.ts` counts `NO_EMPLOYEE` rows as evidence when it
assigns barcodes, and recomputing an alternation direction five days late would
be a guess dressed as a record.

Creates no punches. Those people were paid through the Oracle/NovaTime path;
fabricating punches here could corrupt timecards.

Reversible from `02-scan-attribution-rollback.json`, which holds all 926 row ids:

```sql
UPDATE scan_events SET "employeeId" = NULL WHERE id IN (...);
```

## Order

01 first. It is the one that makes a shipped-but-inert feature work. 02 is
historical tidying and can wait or be skipped.
