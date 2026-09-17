-- Adds the GATE_STATE sync kind.
--
-- The bridge gains a third job: read the latest `timestationscanlog` row per
-- badge out of Oracle and seed it as the SECURITY baseline in scan_events.
--
-- Why it is needed: scan_events resolves IN/OUT by alternating from a badge's
-- previous scan in the same stream, so with no history the first gate scan
-- after go-live always resolves IN — regardless of whether the person was
-- actually walking in or out. Seeding the last known scan removes that one-off
-- skew, which is currently being absorbed as a false legacyMismatch per badge.
--
-- Purely additive: one new enum value, no table or column changes.
--
-- ALTER TYPE ... ADD VALUE is transaction-safe on PostgreSQL 12+ provided the
-- new value is not used in the same transaction. Nothing below uses it.

-- AlterEnum
ALTER TYPE "SyncKind" ADD VALUE 'GATE_STATE';
