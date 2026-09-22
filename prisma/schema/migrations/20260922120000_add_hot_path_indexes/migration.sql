-- Indexes for the columns the product filters by on every screen.
--
-- Measured on the live database on 2026-09-22, before this migration:
--
--   work_segments by timesheetId   seq scan, 29,533 rows discarded, 127ms
--   punches by employeeId          seq scan, 22,230 rows discarded,  94ms
--   dashboard presence card        scans all punches,                60ms
--
-- The segment-builder query alone had run 38,773 times for 487 seconds of
-- database time, the single largest consumer in the instance. Opening one
-- timecard fires about ten of these, so roughly half a second of every
-- timecard was the database re-reading tables it had no index for.
--
-- Prisma does not create indexes for foreign keys on PostgreSQL and the
-- schema never declared them, so these were missing from the first migration
-- rather than dropped later.
--
-- Additive and safe to apply while the previous deployment is serving: no
-- column, type or constraint changes, and no existing query can break. The
-- largest table here is 32,193 rows, so each index builds in milliseconds and
-- the brief write lock is not worth CONCURRENTLY. To undo, DROP INDEX any of
-- them; nothing depends on them existing.

-- Timesheets: a period's sheets by status.
CREATE INDEX IF NOT EXISTS "timesheets_payPeriodId_status_idx" ON "timesheets"("payPeriodId", "status");

-- Punches: a sheet's punches, and a person's most recent ones.
CREATE INDEX IF NOT EXISTS "punches_timesheetId_idx" ON "punches"("timesheetId");
CREATE INDEX IF NOT EXISTS "punches_employeeId_roundedTime_idx" ON "punches"("employeeId", "roundedTime");

-- Work segments: the segment builder's own predicate.
CREATE INDEX IF NOT EXISTS "work_segments_timesheetId_segmentType_idx" ON "work_segments"("timesheetId", "segmentType");
CREATE INDEX IF NOT EXISTS "work_segments_leaveRequestId_idx" ON "work_segments"("leaveRequestId");

-- Exceptions: the open ones for a sheet.
CREATE INDEX IF NOT EXISTS "exceptions_timesheetId_resolvedAt_idx" ON "exceptions"("timesheetId", "resolvedAt");

-- Leave requests: a person's own, and the dashboard's date-range rollups.
CREATE INDEX IF NOT EXISTS "leave_requests_employeeId_status_idx" ON "leave_requests"("employeeId", "status");
CREATE INDEX IF NOT EXISTS "leave_requests_leaveTypeId_idx" ON "leave_requests"("leaveTypeId");
CREATE INDEX IF NOT EXISTS "leave_requests_startDate_idx" ON "leave_requests"("startDate");

-- Accrual ledger: the largest table, always read as one person's history.
CREATE INDEX IF NOT EXISTS "leave_accrual_ledger_employeeId_createdAt_idx" ON "leave_accrual_ledger"("employeeId", "createdAt");
CREATE INDEX IF NOT EXISTS "leave_accrual_ledger_leaveTypeId_idx" ON "leave_accrual_ledger"("leaveTypeId");
CREATE INDEX IF NOT EXISTS "leave_accrual_ledger_leaveRequestId_idx" ON "leave_accrual_ledger"("leaveRequestId");

-- Employees: the roster, the team scopes and the admin filters.
CREATE INDEX IF NOT EXISTS "employees_tenantId_isActive_idx" ON "employees"("tenantId", "isActive");
CREATE INDEX IF NOT EXISTS "employees_supervisorId_idx" ON "employees"("supervisorId");
CREATE INDEX IF NOT EXISTS "employees_siteId_idx" ON "employees"("siteId");
CREATE INDEX IF NOT EXISTS "employees_departmentId_idx" ON "employees"("departmentId");
CREATE INDEX IF NOT EXISTS "employees_ruleSetId_idx" ON "employees"("ruleSetId");

-- Audit log: one tenant, newest first.
CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");
