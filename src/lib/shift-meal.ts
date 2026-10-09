import type { MealConfig } from "@/actions/shift.actions";

/**
 * The meal a day on a shift takes, which is the only place meal settings come
 * from. The rule set's meal fields (autoDeductMeal, mealBreakMinutes,
 * mealBreakAfterMinutes) are no longer read: they stay in the database for
 * builds that still read them, and no screen edits them.
 *
 * - `minutes` / `afterMinutes`: the shift's first meal row. 0 minutes when the
 *   shift has no meal set up, or the person has no shift.
 * - `autoDeduct`: the meal is taken off without a punch. When it is not, the
 *   person punches the meal, and `minutes` is still the meal a full day has
 *   (a leave day is the shift less it).
 */
export type ShiftMeal = { autoDeduct: boolean; minutes: number; afterMinutes: number };

export function shiftMeal(mealConfig: unknown): ShiftMeal {
  const config = mealConfig as Partial<MealConfig> | null | undefined;
  const row = config?.meals?.[0];
  const minutes = Math.max(0, row?.deductMinutes ?? 0);
  return {
    autoDeduct: Boolean(config?.autoDeduct) && minutes > 0,
    minutes,
    afterMinutes: Math.round((row?.workAtLeastHours ?? 0) * 60),
  };
}

/** A shift as the leave day pickers read it: its hours, days and meal. */
export function shiftInfo(shift: { startTime: string; endTime: string; workDays: number[]; mealConfig: unknown }) {
  const meal = shiftMeal(shift.mealConfig);
  return {
    startTime: shift.startTime,
    endTime: shift.endTime,
    workDays: shift.workDays,
    mealBreakMinutes: meal.minutes,
    mealBreakAfterMinutes: meal.afterMinutes,
  };
}
