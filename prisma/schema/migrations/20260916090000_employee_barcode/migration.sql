-- Badge barcode on the employee record.
--
-- Two badge formats are in circulation: a 6-digit employee number (wmsId) and
-- a 10-digit barcode. The legacy API has always translated the second into the
-- first via wmsusers.barcode -> framewrk.users.empid before doing anything
-- else; this system did not, so every 10-digit badge matched nothing and its
-- punches were never recorded. On 2026-09-15 that was 247 distinct badges and
-- roughly 40% of all time clock scans.
--
-- Additive: three nullable/defaulted columns and one unique index. Nothing
-- existing is altered.

ALTER TABLE "employees"
    ADD COLUMN "barcode"         TEXT,
    ADD COLUMN "barcodeOverride" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "barcodeSyncedAt" TIMESTAMP(3);

-- A barcode identifies exactly one person; two employees sharing one would
-- make every scan of it ambiguous. The sync reports conflicts rather than
-- guessing which employee a duplicate belongs to.
CREATE UNIQUE INDEX "employees_barcode_key" ON "employees" ("barcode");
