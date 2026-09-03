import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const TENANT_ID = "cmm9mxrup0000kgug6sa5gw53";

const MEAL_CONFIG = {
  meals: [
    { deductMinutes: 30, mealBeforeHours: 0, workAtLeastHours: 6 },
    { deductMinutes: 0,  mealBeforeHours: 0, workAtLeastHours: 0 },
    { deductMinutes: 0,  mealBeforeHours: 0, workAtLeastHours: 0 },
    { deductMinutes: 0,  mealBeforeHours: 0, workAtLeastHours: 0 },
  ],
  autoDeduct: true,
  maxMealMinutes: 180,
  minMealMinutes: 15,
  createMealBasis: "IN_OUT_PAIR",
  deductionMethod: "HOURS_WORKED",
  doNotSplitPunch: false,
  waivedPayCodeId: "",
  lateOutToMealHours: 0,
  disableMinDeduction: true,
  sendWaivedToPayCode: false,
  lateOutToMealEnabled: false,
  reimbursementEnabled: false,
  reimbursementMinutes: 0,
  absoluteDeductionWindow: false,
  alwaysUseScheduledMeals: false,
  noMealPunchBonusEnabled: false,
  noMealPunchBonusMinutes: 30,
  createMealDeductionHours: 5,
  noMealPunchBonusWorkHours: 5,
  createMealDeductionEnabled: false,
  useMealWindowForAutoDeduct: false,
  dailyReimbursementLimitMinutes: 0,
  doesNotAffectLongMealException: false,
};

function dayRow(day: number, start: string | null, end: string | null) {
  return {
    day,
    dayStart: "00:00",
    dayEnd: "23:59",
    startTime: start,
    endTime: end,
    isWorkday: start !== null,
    mealMinutes: 0,
  };
}

function mfSchedule(start: string, end: string) {
  return [
    dayRow(0, null, null),
    dayRow(1, start, end),
    dayRow(2, start, end),
    dayRow(3, start, end),
    dayRow(4, start, end),
    dayRow(5, start, end),
    dayRow(6, null, null),
  ];
}

const SHIFTS_TO_CREATE = [
  {
    // Tue 08:30–05:00, Wed 01:00–05:00, Thu 01:00–05:00, Fri 08:30–05:00
    number: 521,
    name: "5903 Part Time Office Ranya Schedule",
    startTime: "01:00",
    endTime: "05:00",
    workDays: [2, 3, 4, 5],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, null, null),
      dayRow(1, null, null),
      dayRow(2, "08:30", "05:00"),
      dayRow(3, "01:00", "05:00"),
      dayRow(4, "01:00", "05:00"),
      dayRow(5, "08:30", "05:00"),
      dayRow(6, null, null),
    ],
  },
  {
    // Sun 07:00–15:30, Mon 07:00–18:30, Tue 07:00–18:30, Wed 07:00–17:30
    number: 524,
    name: "5903 Edixon Quintero Sun,Mon,Tues, Wed",
    startTime: "07:00",
    endTime: "18:30",
    workDays: [0, 1, 2, 3],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, "07:00", "15:30"),
      dayRow(1, "07:00", "18:30"),
      dayRow(2, "07:00", "18:30"),
      dayRow(3, "07:00", "17:30"),
      dayRow(4, null, null),
      dayRow(5, null, null),
      dayRow(6, null, null),
    ],
  },
  {
    // Mon 09:00–17:30, Tue 11:00–19:30, Wed 11:00–19:30, Thu 09:00–17:30, Fri 11:00–19:30
    number: 525,
    name: "5903 Liz Viloria - Shipping Clerk Schedu",
    startTime: "09:00",
    endTime: "19:30",
    workDays: [1, 2, 3, 4, 5],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, null, null),
      dayRow(1, "09:00", "17:30"),
      dayRow(2, "11:00", "19:30"),
      dayRow(3, "11:00", "19:30"),
      dayRow(4, "09:00", "17:30"),
      dayRow(5, "11:00", "19:30"),
      dayRow(6, null, null),
    ],
  },
  {
    // Su 7am–3:30pm, Mon–Thu 11am–7:30pm
    number: 522,
    name: "5903 Su 7-3:30pm Mon - Thurs 11-7:30pm",
    startTime: "07:00",
    endTime: "19:30",
    workDays: [0, 1, 2, 3, 4],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, "07:00", "15:30"),
      dayRow(1, "11:00", "19:30"),
      dayRow(2, "11:00", "19:30"),
      dayRow(3, "11:00", "19:30"),
      dayRow(4, "11:00", "19:30"),
      dayRow(5, null, null),
      dayRow(6, null, null),
    ],
  },
  {
    // Su 7am–3:30pm, Mon–Thu 9am–5:30pm
    number: 523,
    name: "5903 Su 7-3:30pm Mon - Thurs 9-5:30pm",
    startTime: "07:00",
    endTime: "17:30",
    workDays: [0, 1, 2, 3, 4],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, "07:00", "15:30"),
      dayRow(1, "09:00", "17:30"),
      dayRow(2, "09:00", "17:30"),
      dayRow(3, "09:00", "17:30"),
      dayRow(4, "09:00", "17:30"),
      dayRow(5, null, null),
      dayRow(6, null, null),
    ],
  },
  {
    number: 509,
    name: "5903 LPO Humberto Shift",
    startTime: "06:30",
    endTime: "15:30",
    workDays: [1, 2, 3, 4, 5],
    shiftType: "FIXED" as const,
    daySchedule: mfSchedule("06:30", "15:30"),
  },
  {
    number: 510,
    name: "5903 LPO Alex Shift",
    startTime: "10:00",
    endTime: "20:00",
    workDays: [1, 2, 3, 4, 5],
    shiftType: "FIXED" as const,
    daySchedule: mfSchedule("10:00", "20:00"),
  },
  {
    // Mon–Thu 18:00–23:59, Fri 18:00–20:00
    number: 513,
    name: "5903 LPO Geraldina Shift",
    startTime: "18:00",
    endTime: "23:59",
    workDays: [1, 2, 3, 4, 5],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, null, null),
      dayRow(1, "18:00", "23:59"),
      dayRow(2, "18:00", "23:59"),
      dayRow(3, "18:00", "23:59"),
      dayRow(4, "18:00", "23:59"),
      dayRow(5, "18:00", "20:00"),
      dayRow(6, null, null),
    ],
  },
  {
    number: 505,
    name: "5903 M-F 8:30a-5p 30m",
    startTime: "08:30",
    endTime: "17:00",
    workDays: [1, 2, 3, 4, 5],
    shiftType: "FIXED" as const,
    daySchedule: mfSchedule("08:30", "17:00"),
  },
  {
    number: 515,
    name: "5903 M-F 7:00a-5:30p 30m (CSM/BO)",
    startTime: "07:00",
    endTime: "17:30",
    workDays: [1, 2, 3, 4, 5],
    shiftType: "DYNAMIC" as const,
    daySchedule: mfSchedule("07:00", "17:30"),
  },
  {
    number: 516,
    name: "5903 M-F 10a-6:30p 30m",
    startTime: "10:00",
    endTime: "18:30",
    workDays: [1, 2, 3, 4, 5],
    shiftType: "FIXED" as const,
    daySchedule: mfSchedule("10:00", "18:30"),
  },
  {
    number: 517,
    name: "5903 M-Th. 9-7:30pm 30m",
    startTime: "09:00",
    endTime: "19:30",
    workDays: [1, 2, 3, 4],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, null, null),
      dayRow(1, "09:00", "19:30"),
      dayRow(2, "09:00", "19:30"),
      dayRow(3, "09:00", "19:30"),
      dayRow(4, "09:00", "19:30"),
      dayRow(5, null, null),
      dayRow(6, null, null),
    ],
  },
  {
    number: 518,
    name: "5903 Tu-Fri. 7-5:30pm 30m",
    startTime: "07:00",
    endTime: "17:30",
    workDays: [2, 3, 4, 5],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, null, null),
      dayRow(1, null, null),
      dayRow(2, "07:00", "17:30"),
      dayRow(3, "07:00", "17:30"),
      dayRow(4, "07:00", "17:30"),
      dayRow(5, "07:00", "17:30"),
      dayRow(6, null, null),
    ],
  },
  {
    number: 519,
    name: "5903 Su-Tues 7-3:30",
    startTime: "07:00",
    endTime: "15:30",
    workDays: [0, 1, 2],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, "07:00", "15:30"),
      dayRow(1, "07:00", "15:30"),
      dayRow(2, "07:00", "15:30"),
      dayRow(3, null, null),
      dayRow(4, null, null),
      dayRow(5, null, null),
      dayRow(6, null, null),
    ],
  },
  {
    // Sun 7am–3:30pm, Mon–Thu 11am–7:30pm
    number: 520,
    name: "5903 Sun 7:3:30 / M-Thurs 11-7:30 PM",
    startTime: "07:00",
    endTime: "19:30",
    workDays: [0, 1, 2, 3, 4],
    shiftType: "FIXED" as const,
    daySchedule: [
      dayRow(0, "07:00", "15:30"),
      dayRow(1, "11:00", "19:30"),
      dayRow(2, "11:00", "19:30"),
      dayRow(3, "11:00", "19:30"),
      dayRow(4, "11:00", "19:30"),
      dayRow(5, null, null),
      dayRow(6, null, null),
    ],
  },
];

export async function GET() {
  const log: string[] = [];

  // Fetch existing shift numbers to avoid duplicates
  const existing = await db.shift.findMany({
    where: { tenantId: TENANT_ID },
    select: { number: true, name: true },
  });
  const existingNumbers = new Set(existing.map((s) => s.number));
  const existingNames   = new Set(existing.map((s) => s.name));

  let created = 0, skipped = 0;

  for (const s of SHIFTS_TO_CREATE) {
    if (existingNumbers.has(s.number) || existingNames.has(s.name)) {
      log.push(`  — skipped  #${s.number} "${s.name}" (already exists)`);
      skipped++;
      continue;
    }

    await db.shift.create({
      data: {
        tenantId: TENANT_ID,
        number: s.number,
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
        workDays: s.workDays,
        shiftType: s.shiftType,
        shiftCycle: "WEEKLY",
        daySchedule: s.daySchedule,
        mealConfig: MEAL_CONFIG,
      },
    });
    log.push(`  ✓ created  #${s.number} "${s.name}"`);
    created++;
  }

  return NextResponse.json({ created, skipped, log });
}
