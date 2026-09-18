-- Adds AUTO_CLOSE to ScanDirectionSource.
--
-- Marks a scan row the nightly auto-close wrote rather than one anybody made at
-- a reader. Kept distinct from ALTERNATION because it is not an inference that
-- might be wrong — it is an admission that no exit scan ever arrived, and it is
-- the thing the "who is not clocking out" report counts.
--
-- Purely additive: one enum value, no table or column changes.
--
-- ALTER TYPE ... ADD VALUE is transaction-safe on PostgreSQL 12+ provided the
-- new value is not used in the same transaction. Nothing below uses it.

-- AlterEnum
ALTER TYPE "ScanDirectionSource" ADD VALUE 'AUTO_CLOSE';
