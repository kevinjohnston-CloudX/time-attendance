-- Every card a person can physically present, not just the last one Oracle
-- mentioned. Oracle keeps one wmsusers row per card, so a re-issued badge
-- leaves the old row in place; Employee.barcode can hold only one of them.
-- Measured 2026-09-21: 95 employee numbers carry 2-4 barcodes, 10 of those
-- people are active, and 41 scans over 14 days resolved to no employee.
-- CreateEnum
CREATE TYPE "BadgeSource" AS ENUM ('ORACLE', 'MANUAL');

-- CreateTable
CREATE TABLE "employee_badges" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "source" "BadgeSource" NOT NULL DEFAULT 'ORACLE',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_badges_pkey" PRIMARY KEY ("id")
);

-- A card identifies exactly one person. The same invariant employees.barcode
-- already carries, so that the two stores cannot disagree about a badge.
-- CreateIndex
CREATE UNIQUE INDEX "employee_badges_barcode_key" ON "employee_badges"("barcode");

-- CreateIndex
CREATE INDEX "employee_badges_employeeId_idx" ON "employee_badges"("employeeId");

-- AddForeignKey
ALTER TABLE "employee_badges" ADD CONSTRAINT "employee_badges_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
