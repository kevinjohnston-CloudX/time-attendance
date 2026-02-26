-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'SUPERVISOR', 'PAYROLL_ADMIN', 'HR_ADMIN', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "PunchType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'MEAL_START', 'MEAL_END', 'BREAK_START', 'BREAK_END');

-- CreateEnum
CREATE TYPE "PunchState" AS ENUM ('OUT', 'WORK', 'MEAL', 'BREAK');

-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('WEB', 'KIOSK', 'MOBILE', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SegmentType" AS ENUM ('WORK', 'MEAL', 'BREAK');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('OPEN', 'SUBMITTED', 'SUP_APPROVED', 'PAYROLL_APPROVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "PayPeriodStatus" AS ENUM ('OPEN', 'READY', 'LOCKED');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'POSTED');

-- CreateEnum
CREATE TYPE "LeaveCategory" AS ENUM ('PTO', 'SICK', 'HOLIDAY', 'FMLA', 'BEREAVEMENT', 'JURY_DUTY', 'MILITARY', 'UNPAID');

-- CreateEnum
CREATE TYPE "PayBucket" AS ENUM ('REG', 'OT', 'DT', 'PTO', 'SICK', 'HOLIDAY', 'FMLA', 'BEREAVEMENT', 'JURY_DUTY', 'MILITARY', 'UNPAID');

-- CreateEnum
CREATE TYPE "AccrualAction" AS ENUM ('ACCRUAL', 'USAGE', 'ADJUSTMENT', 'CARRY_OVER', 'FORFEITURE');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('MISSING_PUNCH', 'LONG_SHIFT', 'SHORT_BREAK', 'MISSED_MEAL', 'UNSCHEDULED_OT', 'CONSECUTIVE_DAYS');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('USER', 'EMPLOYEE', 'PUNCH', 'TIMESHEET', 'PAY_PERIOD', 'LEAVE_REQUEST', 'LEAVE_BALANCE', 'RULE_SET', 'DOCUMENT');

-- CreateTable
CREATE TABLE "pay_periods" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PayPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pay_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'OPEN',
    "submittedAt" TIMESTAMP(3),
    "supApprovedAt" TIMESTAMP(3),
    "supApprovedById" TEXT,
    "payrollApprovedAt" TIMESTAMP(3),
    "payrollApprovedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punches" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "punchType" "PunchType" NOT NULL,
    "punchTime" TIMESTAMP(3) NOT NULL,
    "roundedTime" TIMESTAMP(3) NOT NULL,
    "source" "PunchSource" NOT NULL DEFAULT 'WEB',
    "stateBefore" "PunchState" NOT NULL,
    "stateAfter" "PunchState" NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT true,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "note" TEXT,
    "correctsId" TEXT,
    "correctedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_segments" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "segmentType" "SegmentType" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "segmentDate" DATE NOT NULL,
    "isPaid" BOOLEAN NOT NULL,
    "payBucket" "PayBucket" NOT NULL,
    "isSplit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exceptions" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "exceptionType" "ExceptionType" NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LeaveCategory" NOT NULL,
    "accrualRateMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxBalanceMinutes" INTEGER,
    "carryOverMinutes" INTEGER NOT NULL DEFAULT 0,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "balanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "usedMinutes" INTEGER NOT NULL DEFAULT 0,
    "accrualYear" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "note" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_accrual_ledger" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "action" "AccrualAction" NOT NULL,
    "deltaMinutes" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "leaveRequestId" TEXT,
    "payPeriodEnd" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "leave_accrual_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "supervisorId" TEXT,
    "siteId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hireDate" TIMESTAMP(3) NOT NULL,
    "terminatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_buckets" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "bucket" "PayBucket" NOT NULL,
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overtime_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "status" "PayPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "exportedAt" TIMESTAMP(3),
    "exportedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_sets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dailyOtMinutes" INTEGER NOT NULL DEFAULT 480,
    "dailyDtMinutes" INTEGER NOT NULL DEFAULT 720,
    "weeklyOtMinutes" INTEGER NOT NULL DEFAULT 2400,
    "consecutiveDayOtDay" INTEGER NOT NULL DEFAULT 7,
    "punchRoundingMinutes" INTEGER NOT NULL DEFAULT 0,
    "mealBreakMinutes" INTEGER NOT NULL DEFAULT 30,
    "mealBreakAfterMinutes" INTEGER NOT NULL DEFAULT 300,
    "autoDeductMeal" BOOLEAN NOT NULL DEFAULT false,
    "shortBreakMinutes" INTEGER NOT NULL DEFAULT 15,
    "shortBreaksPerDay" INTEGER NOT NULL DEFAULT 2,
    "longShiftMinutes" INTEGER NOT NULL DEFAULT 720,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pay_periods_startDate_endDate_key" ON "pay_periods"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_employeeId_payPeriodId_key" ON "timesheets"("employeeId", "payPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "punches_correctsId_key" ON "punches"("correctsId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeId_leaveTypeId_accrualYear_key" ON "leave_balances"("employeeId", "leaveTypeId", "accrualYear");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key" ON "employees"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "overtime_buckets_timesheetId_bucket_key" ON "overtime_buckets"("timesheetId", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_payPeriodId_key" ON "payroll_runs"("payPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "rule_sets_name_key" ON "rule_sets"("name");

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "pay_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punches" ADD CONSTRAINT "punches_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punches" ADD CONSTRAINT "punches_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punches" ADD CONSTRAINT "punches_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_segments" ADD CONSTRAINT "work_segments_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_ledger" ADD CONSTRAINT "leave_accrual_ledger_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_ledger" ADD CONSTRAINT "leave_accrual_ledger_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_buckets" ADD CONSTRAINT "overtime_buckets_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
