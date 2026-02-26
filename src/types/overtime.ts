export interface DayBreakdown {
  date: string; // "yyyy-MM-dd"
  workMinutes: number;
  regMinutes: number;
  otMinutes: number;
  dtMinutes: number;
  isConsecutiveOtDay: boolean;
}

export interface OvertimeResult {
  days: DayBreakdown[];
  totalReg: number;
  totalOt: number;
  totalDt: number;
  weeklyOtConverted: number; // REG minutes converted to OT by weekly threshold
}
