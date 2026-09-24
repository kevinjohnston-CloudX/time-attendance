-- Add MEAL_PREMIUM to the SegmentType enum.
-- Safe to deploy alongside code: ADD VALUE is an additive, non-locking operation.
ALTER TYPE "SegmentType" ADD VALUE 'MEAL_PREMIUM';
