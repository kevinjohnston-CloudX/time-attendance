-- Add EARNED_ADJUSTMENT to AccrualAction enum (counts toward accrued total like ACCRUAL, but posted manually)
ALTER TYPE "AccrualAction" ADD VALUE IF NOT EXISTS 'EARNED_ADJUSTMENT';
