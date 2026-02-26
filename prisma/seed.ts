import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import path from "node:path";
import { addDays, startOfDay, subDays, isWeekend } from "date-fns";

config({ path: path.resolve(process.cwd(), ".env.local") });

const pool = new Pool({ connectionString: process.env.DIRECT_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a Date at the given hour:minute on a base date. */
function at(date: Date, hour: number, minute = 0): Date {
  return new Date(
    date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0
  );
}

/** Return all Mon–Fri dates within [start, end] inclusive. */
function workdays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (let d = startOfDay(start); d <= end; d = addDays(d, 1)) {
    if (!isWeekend(d)) days.push(new Date(d));
  }
  return days;
}

/** Minutes between two Dates. */
function mins(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

// ── Pay period dates (biweekly, Mon–Sun×2) ───────────────────────────────────
const PA_START = new Date("2026-01-05");  const PA_END = new Date("2026-01-18");
const PB_START = new Date("2026-01-19");  const PB_END = new Date("2026-02-01");
const PC_START = new Date("2026-02-02");  const PC_END = new Date("2026-02-15");
const PD_START = new Date("2026-02-16");  const PD_END = new Date("2026-03-01");

// ── Employee definitions ──────────────────────────────────────────────────────
const EMP_DEFS = [
  { id: "emp-seed-01", username: "admin",       name: "Alex Admin",     email: "admin@example.com",   code: "EMP-001", role: "SYSTEM_ADMIN",  dept: "dept-hr",   sup: null,       inOffset:  0, outOffset:  0 },
  { id: "emp-seed-02", username: "hr.johnson",  name: "Alice Johnson",  email: "alice@example.com",   code: "EMP-002", role: "HR_ADMIN",      dept: "dept-hr",   sup: null,       inOffset:  0, outOffset:  0 },
  { id: "emp-seed-03", username: "payroll.bob", name: "Bob Smith",      email: "bob@example.com",     code: "EMP-003", role: "PAYROLL_ADMIN", dept: "dept-hr",   sup: null,       inOffset:  5, outOffset: -5 },
  { id: "emp-seed-04", username: "sup.carol",   name: "Carol Davis",    email: "carol@example.com",   code: "EMP-004", role: "SUPERVISOR",    dept: "dept-eng",  sup: null,       inOffset: -10, outOffset: 0 },
  { id: "emp-seed-05", username: "sup.david",   name: "David Lee",      email: "david@example.com",   code: "EMP-005", role: "SUPERVISOR",    dept: "dept-wh",   sup: null,       inOffset:  0, outOffset:  0 },
  { id: "emp-seed-06", username: "emp.emily",   name: "Emily Chen",     email: "emily@example.com",   code: "EMP-006", role: "EMPLOYEE",      dept: "dept-eng",  sup: "emp-seed-04", inOffset: 0, outOffset: 0 },
  { id: "emp-seed-07", username: "emp.frank",   name: "Frank Wilson",   email: "frank@example.com",   code: "EMP-007", role: "EMPLOYEE",      dept: "dept-eng",  sup: "emp-seed-04", inOffset: -15, outOffset: -15 },
  { id: "emp-seed-08", username: "emp.grace",   name: "Grace Kim",      email: "grace@example.com",   code: "EMP-008", role: "EMPLOYEE",      dept: "dept-eng",  sup: "emp-seed-04", inOffset: 10, outOffset: 10 },
  { id: "emp-seed-09", username: "emp.henry",   name: "Henry Brown",    email: "henry@example.com",   code: "EMP-009", role: "EMPLOYEE",      dept: "dept-wh",   sup: "emp-seed-05", inOffset: 0, outOffset: 0 },
  { id: "emp-seed-10", username: "emp.iris",    name: "Iris Martinez",  email: "iris@example.com",    code: "EMP-010", role: "EMPLOYEE",      dept: "dept-wh",   sup: "emp-seed-05", inOffset: -5, outOffset: -5 },
  { id: "emp-seed-11", username: "emp.james",   name: "James Taylor",   email: "james@example.com",   code: "EMP-011", role: "EMPLOYEE",      dept: "dept-wh",   sup: "emp-seed-05", inOffset: 5, outOffset: 5 },
] as const;

// ── Timesheet statuses per period ─────────────────────────────────────────────
//   PA = LOCKED, PB = PAYROLL_APPROVED (period READY), PC = mixed, PD = OPEN
const TS_STATUS: Record<string, Record<string, string>> = {
  PA: { "emp-seed-01": "LOCKED", "emp-seed-02": "LOCKED", "emp-seed-03": "LOCKED", "emp-seed-04": "LOCKED", "emp-seed-05": "LOCKED", "emp-seed-06": "LOCKED", "emp-seed-07": "LOCKED", "emp-seed-08": "LOCKED", "emp-seed-09": "LOCKED", "emp-seed-10": "LOCKED", "emp-seed-11": "LOCKED" },
  PB: { "emp-seed-01": "PAYROLL_APPROVED", "emp-seed-02": "PAYROLL_APPROVED", "emp-seed-03": "PAYROLL_APPROVED", "emp-seed-04": "PAYROLL_APPROVED", "emp-seed-05": "PAYROLL_APPROVED", "emp-seed-06": "PAYROLL_APPROVED", "emp-seed-07": "PAYROLL_APPROVED", "emp-seed-08": "PAYROLL_APPROVED", "emp-seed-09": "PAYROLL_APPROVED", "emp-seed-10": "PAYROLL_APPROVED", "emp-seed-11": "PAYROLL_APPROVED" },
  PC: { "emp-seed-01": "PAYROLL_APPROVED", "emp-seed-02": "PAYROLL_APPROVED", "emp-seed-03": "PAYROLL_APPROVED", "emp-seed-04": "PAYROLL_APPROVED", "emp-seed-05": "PAYROLL_APPROVED", "emp-seed-06": "SUBMITTED", "emp-seed-07": "SUBMITTED", "emp-seed-08": "OPEN", "emp-seed-09": "SUP_APPROVED", "emp-seed-10": "SUBMITTED", "emp-seed-11": "OPEN" },
  PD: { "emp-seed-01": "OPEN", "emp-seed-02": "OPEN", "emp-seed-03": "OPEN", "emp-seed-04": "OPEN", "emp-seed-05": "OPEN", "emp-seed-06": "OPEN", "emp-seed-07": "OPEN", "emp-seed-08": "OPEN", "emp-seed-09": "OPEN", "emp-seed-10": "OPEN", "emp-seed-11": "OPEN" },
};

async function main() {
  console.log("🌱 Seeding database...\n");

  // ── 1. Clear transactional data ─────────────────────────────────────────────
  console.log("  Clearing existing transactional data...");
  await db.auditLog.deleteMany({});
  await db.overtimeBucket.deleteMany({});
  await db.workSegment.deleteMany({});
  await db.exception.deleteMany({});
  await db.punch.deleteMany({});
  await db.timesheet.deleteMany({});
  await db.leaveAccrualLedger.deleteMany({});
  await db.leaveBalance.deleteMany({});
  await db.leaveRequest.deleteMany({});
  await db.document.deleteMany({});
  console.log("  ✓ Cleared\n");

  // ── 2. Rule Sets (one per OT-law preset) ─────────────────────────────────────
  // Federal FLSA — OT after 40h/week only (default for most states)
  const rsDefault = await db.ruleSet.upsert({
    where: { name: "Federal FLSA" },
    update: {},
    create: { name: "Federal FLSA", isDefault: true, dailyOtMinutes: 1440, dailyDtMinutes: 1440, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 },
  });
  // California — OT after 8h/day, DT after 12h/day, OT after 40h/week
  const rsCalifornia = await db.ruleSet.upsert({
    where: { name: "California" },
    update: {},
    create: { name: "California", dailyOtMinutes: 480, dailyDtMinutes: 720, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 },
  });
  // Daily 8h OT — OT after 8h/day or 40h/week (AK, NV, PR style)
  const rsDaily8 = await db.ruleSet.upsert({
    where: { name: "Daily 8h OT" },
    update: {},
    create: { name: "Daily 8h OT", dailyOtMinutes: 480, dailyDtMinutes: 1440, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7, autoDeductMeal: true },
  });
  // Daily 12h OT — OT after 12h/day or 40h/week (CO style)
  const rsDaily12 = await db.ruleSet.upsert({
    where: { name: "Daily 12h OT" },
    update: {},
    create: { name: "Daily 12h OT", dailyOtMinutes: 720, dailyDtMinutes: 1440, weeklyOtMinutes: 2400, consecutiveDayOtDay: 7 },
  });
  const rsWarehouse = rsDaily8; // alias — warehouse employees use Daily 8h OT
  console.log(
    `✓ Rule Sets: ${[rsDefault, rsCalifornia, rsDaily8, rsDaily12].map((r) => r.name).join(", ")}`
  );

  // ── 3. Sites & Departments ───────────────────────────────────────────────────
  const siteMain = await db.site.upsert({ where: { id: "site-main" }, update: {}, create: { id: "site-main", name: "Main Office", timezone: "America/New_York", address: "100 Corporate Blvd, New York, NY" } });
  const siteWh   = await db.site.upsert({ where: { id: "site-wh" },   update: {}, create: { id: "site-wh",   name: "Warehouse",    timezone: "America/Chicago",  address: "500 Industrial Way, Chicago, IL" } });

  await db.department.upsert({ where: { id: "dept-hr" },  update: {}, create: { id: "dept-hr",  name: "HR & Admin",    siteId: siteMain.id } });
  await db.department.upsert({ where: { id: "dept-eng" }, update: {}, create: { id: "dept-eng", name: "Engineering",   siteId: siteMain.id } });
  await db.department.upsert({ where: { id: "dept-ops" }, update: {}, create: { id: "dept-ops", name: "Operations",    siteId: siteMain.id } });
  await db.department.upsert({ where: { id: "dept-wh" },  update: {}, create: { id: "dept-wh",  name: "Warehouse Ops", siteId: siteWh.id   } });
  console.log("✓ Sites: Main Office, Warehouse");
  console.log("✓ Departments: HR & Admin, Engineering, Operations, Warehouse Ops");

  // ── 4. Pay Periods ───────────────────────────────────────────────────────────
  const ppA = await db.payPeriod.upsert({ where: { startDate_endDate: { startDate: PA_START, endDate: PA_END } }, update: {}, create: { startDate: PA_START, endDate: PA_END, status: "LOCKED" } });
  const ppB = await db.payPeriod.upsert({ where: { startDate_endDate: { startDate: PB_START, endDate: PB_END } }, update: {}, create: { startDate: PB_START, endDate: PB_END, status: "READY" } });
  const ppC = await db.payPeriod.upsert({ where: { startDate_endDate: { startDate: PC_START, endDate: PC_END } }, update: {}, create: { startDate: PC_START, endDate: PC_END, status: "OPEN" } });
  const ppD = await db.payPeriod.upsert({ where: { startDate_endDate: { startDate: PD_START, endDate: PD_END } }, update: {}, create: { startDate: PD_START, endDate: PD_END, status: "OPEN" } });
  const periods = [
    { key: "PA", pp: ppA, start: PA_START, end: PA_END },
    { key: "PB", pp: ppB, start: PB_START, end: PB_END },
    { key: "PC", pp: ppC, start: PC_START, end: PC_END },
    { key: "PD", pp: ppD, start: PD_START, end: PD_END },
  ];
  console.log("✓ Pay Periods: PA (LOCKED), PB (READY), PC (OPEN/mixed), PD (OPEN/current)");

  // ── 5. Users & Employees ─────────────────────────────────────────────────────
  const pw = await bcrypt.hash("password123", 10);
  const adminPw = await bcrypt.hash("admin123", 10);

  const empMap: Record<string, string> = {}; // empDefId → DB employee.id

  for (const def of EMP_DEFS) {
    const ruleSetId = def.dept === "dept-wh" ? rsWarehouse.id : rsDefault.id;
    const siteId    = def.dept === "dept-wh" ? siteWh.id : siteMain.id;

    const user = await db.user.upsert({
      where: { username: def.username },
      update: { name: def.name },
      create: {
        username: def.username,
        name: def.name,
        email: def.email,
        passwordHash: def.username === "admin" ? adminPw : pw,
      },
    });

    const emp = await db.employee.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        id: def.id,
        userId: user.id,
        employeeCode: def.code,
        role: def.role as never,
        siteId,
        departmentId: def.dept,
        ruleSetId,
        hireDate: subDays(new Date(), 365 + Math.floor(Math.random() * 730)),
        supervisorId: null, // set in pass 2
      },
    });
    empMap[def.id] = emp.id;
  }

  // Set supervisors (pass 2)
  for (const def of EMP_DEFS) {
    if (def.sup) {
      await db.employee.update({ where: { id: empMap[def.id] }, data: { supervisorId: empMap[def.sup] } });
    }
  }
  console.log(`✓ ${EMP_DEFS.length} Users & Employees created`);
  console.log("  Passwords: admin=admin123, everyone else=password123");

  // ── 6. Leave Types ────────────────────────────────────────────────────────────
  const ltPTO = await db.leaveType.upsert({ where: { id: "lt-pto" },  update: {}, create: { id: "lt-pto",  name: "PTO",          category: "PTO",      accrualRateMinutes: 160,  maxBalanceMinutes: 12800, carryOverMinutes: 4800 } });
  const ltSick = await db.leaveType.upsert({ where: { id: "lt-sick" }, update: {}, create: { id: "lt-sick", name: "Sick Leave",    category: "SICK",     accrualRateMinutes: 80,   maxBalanceMinutes: 4800,  carryOverMinutes: 0 } });
  await db.leaveType.upsert({ where: { id: "lt-hol" },  update: {}, create: { id: "lt-hol",  name: "Holiday",       category: "HOLIDAY",  accrualRateMinutes: 0,    maxBalanceMinutes: null,  carryOverMinutes: 0, requiresApproval: false } });
  await db.leaveType.upsert({ where: { id: "lt-fmla" }, update: {}, create: { id: "lt-fmla", name: "FMLA",          category: "FMLA",     accrualRateMinutes: 0,    maxBalanceMinutes: null,  carryOverMinutes: 0 } });
  console.log("✓ Leave Types: PTO, Sick Leave, Holiday, FMLA");

  // Leave balances (current year 2026)
  const leaveBalances = [];
  for (const def of EMP_DEFS) {
    leaveBalances.push({ employeeId: empMap[def.id], leaveTypeId: ltPTO.id,  accrualYear: 2026, balanceMinutes: 1920, usedMinutes: 0 });
    leaveBalances.push({ employeeId: empMap[def.id], leaveTypeId: ltSick.id, accrualYear: 2026, balanceMinutes: 480,  usedMinutes: 0 });
  }
  await db.leaveBalance.createMany({ data: leaveBalances });
  console.log("✓ Leave Balances: PTO=32h, Sick=8h per employee");

  // ── 7. Timesheets + Punches + Segments + OT Buckets ──────────────────────────
  console.log("\n  Building timesheets, punches and segments...");

  const approverEmpId = "emp-seed-03"; // Bob (Payroll Admin) approves timesheets

  for (const { key, pp, start, end } of periods) {
    const days = workdays(start, end);
    // For PD (current) only seed the first week (Feb 16-20) — leave 23+ empty
    const seededDays = key === "PD" ? days.filter((d) => d <= new Date("2026-02-20")) : days;

    for (const def of EMP_DEFS) {
      const tsStatus = TS_STATUS[key][def.id];

      // Timestamps for the timesheet approval chain
      const midPeriod = addDays(end, 2);
      const tsData: Record<string, unknown> = { status: tsStatus };
      if (tsStatus !== "OPEN") {
        tsData.submittedAt = midPeriod;
      }
      if (["SUP_APPROVED", "PAYROLL_APPROVED", "LOCKED"].includes(tsStatus)) {
        tsData.supApprovedAt    = addDays(midPeriod, 1);
        tsData.supApprovedById  = empMap[def.sup ?? "emp-seed-02"];
      }
      if (["PAYROLL_APPROVED", "LOCKED"].includes(tsStatus)) {
        tsData.payrollApprovedAt    = addDays(midPeriod, 2);
        tsData.payrollApprovedById  = empMap[approverEmpId];
      }
      if (tsStatus === "LOCKED") {
        tsData.lockedAt = addDays(midPeriod, 3);
      }

      const ts = await db.timesheet.create({
        data: {
          employeeId: empMap[def.id],
          payPeriodId: pp.id,
          ...(tsData as object),
        },
      });

      // Build punches and segments for this timesheet
      const allPunches: Parameters<typeof db.punch.createMany>[0]["data"] = [];
      const allSegments: Parameters<typeof db.workSegment.createMany>[0]["data"] = [];
      let totalRegMins = 0, totalOtMins = 0, totalDtMins = 0;

      for (const day of seededDays) {
        // Every other Friday: OT shift; otherwise regular
        const dayNum = Math.floor((day.getTime() - start.getTime()) / 86_400_000);
        const isOtDay = day.getDay() === 5 && dayNum % 4 === 0;

        const ciH = 8, ciM = 0 + def.inOffset;
        const msH = 12, msM = 0;
        const meH = 12, meM = 30;
        const coH = isOtDay ? 19 : 16, coM = isOtDay ? 0 : 30 + def.outOffset;

        const clockIn    = at(day, ciH, ciM);
        const mealStart  = at(day, msH, msM);
        const mealEnd    = at(day, meH, meM);
        const clockOut   = at(day, coH, coM);

        allPunches.push(
          { timesheetId: ts.id, employeeId: empMap[def.id], punchType: "CLOCK_IN",    punchTime: clockIn,   roundedTime: clockIn,   source: "WEB", stateBefore: "OUT",  stateAfter: "WORK", isApproved: true },
          { timesheetId: ts.id, employeeId: empMap[def.id], punchType: "MEAL_START",  punchTime: mealStart, roundedTime: mealStart, source: "WEB", stateBefore: "WORK", stateAfter: "MEAL", isApproved: true },
          { timesheetId: ts.id, employeeId: empMap[def.id], punchType: "MEAL_END",    punchTime: mealEnd,   roundedTime: mealEnd,   source: "WEB", stateBefore: "MEAL", stateAfter: "WORK", isApproved: true },
          { timesheetId: ts.id, employeeId: empMap[def.id], punchType: "CLOCK_OUT",   punchTime: clockOut,  roundedTime: clockOut,  source: "WEB", stateBefore: "WORK", stateAfter: "OUT",  isApproved: true }
        );

        const morn  = mins(clockIn, mealStart);   // morning work
        const after = mins(mealEnd, clockOut);    // afternoon work
        const meal  = mins(mealStart, mealEnd);   // unpaid meal
        const workTotal = morn + after;

        allSegments.push(
          { timesheetId: ts.id, segmentType: "WORK", startTime: clockIn,   endTime: mealStart, durationMinutes: morn,  segmentDate: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())), isPaid: true,  payBucket: "REG", isSplit: false },
          { timesheetId: ts.id, segmentType: "MEAL", startTime: mealStart, endTime: mealEnd,   durationMinutes: meal,  segmentDate: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())), isPaid: false, payBucket: "UNPAID", isSplit: false },
          { timesheetId: ts.id, segmentType: "WORK", startTime: mealEnd,   endTime: clockOut,  durationMinutes: after, segmentDate: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())), isPaid: true,  payBucket: "REG", isSplit: false }
        );

        // Daily OT classification
        const ruleOtMin = def.dept === "dept-wh" ? 480 : 480;
        const rulesDtMin = 720;
        const dailyDt  = Math.max(0, workTotal - rulesDtMin);
        const dailyOt  = Math.max(0, Math.min(workTotal, rulesDtMin) - ruleOtMin);
        const dailyReg = workTotal - dailyDt - dailyOt;
        totalRegMins += dailyReg;
        totalOtMins  += dailyOt;
        totalDtMins  += dailyDt;
      }

      if (allPunches.length > 0) {
        await db.punch.createMany({ data: allPunches as never });
        await db.workSegment.createMany({ data: allSegments as never });
      }

      // Weekly OT: apply 40h (2400 min) threshold per calendar week
      const numWeeks = Math.max(1, Math.round(seededDays.length / 5));
      const weeklyOtConverted = Math.max(0, totalRegMins - 2400 * numWeeks);
      const finalReg = totalRegMins - weeklyOtConverted;
      const finalOt  = totalOtMins + weeklyOtConverted;

      await db.overtimeBucket.createMany({
        data: [
          { timesheetId: ts.id, bucket: "REG", totalMinutes: finalReg },
          { timesheetId: ts.id, bucket: "OT",  totalMinutes: finalOt },
          { timesheetId: ts.id, bucket: "DT",  totalMinutes: totalDtMins },
        ],
      });
    }
    console.log(`  ✓ ${key}: ${EMP_DEFS.length} timesheets, ${seededDays.length} days each`);
  }

  // ── 8. Leave Requests ────────────────────────────────────────────────────────
  await db.leaveRequest.createMany({
    data: [
      // Emily: Pending PTO (Spring vacation)
      { employeeId: empMap["emp-seed-06"], leaveTypeId: ltPTO.id,  status: "PENDING",  startDate: new Date("2026-03-09"), endDate: new Date("2026-03-13"), durationMinutes: 2400, note: "Spring vacation",  submittedAt: new Date("2026-02-20") },
      // Frank: Approved sick leave (already taken in Period C)
      { employeeId: empMap["emp-seed-07"], leaveTypeId: ltSick.id, status: "APPROVED", startDate: new Date("2026-02-12"), endDate: new Date("2026-02-12"), durationMinutes: 480,  note: "Flu",             submittedAt: new Date("2026-02-11"), reviewedAt: new Date("2026-02-11"), reviewedById: empMap["emp-seed-04"] },
      // Henry: Posted PTO
      { employeeId: empMap["emp-seed-09"], leaveTypeId: ltPTO.id,  status: "POSTED",   startDate: new Date("2026-01-26"), endDate: new Date("2026-01-26"), durationMinutes: 480,  note: "Personal day",    submittedAt: new Date("2026-01-20"), reviewedAt: new Date("2026-01-21"), reviewedById: empMap["emp-seed-05"], postedAt: new Date("2026-02-05") },
      // Grace: Draft (not submitted yet)
      { employeeId: empMap["emp-seed-08"], leaveTypeId: ltPTO.id,  status: "DRAFT",    startDate: new Date("2026-03-02"), endDate: new Date("2026-03-02"), durationMinutes: 480,  note: "Appointment" },
      // Iris: Pending sick leave
      { employeeId: empMap["emp-seed-10"], leaveTypeId: ltSick.id, status: "PENDING",  startDate: new Date("2026-02-26"), endDate: new Date("2026-02-26"), durationMinutes: 480,  note: "Not feeling well", submittedAt: new Date("2026-02-25") },
    ],
  });
  console.log("\n✓ Leave Requests: 5 (PENDING×2, APPROVED, POSTED, DRAFT)");

  // ── 9. Exceptions ─────────────────────────────────────────────────────────────
  // Find Grace's Period C timesheet
  const gracePcTs = await db.timesheet.findFirst({
    where: { employeeId: empMap["emp-seed-08"], payPeriod: { startDate: PC_START } },
  });
  const henryPcTs = await db.timesheet.findFirst({
    where: { employeeId: empMap["emp-seed-09"], payPeriod: { startDate: PC_START } },
  });

  if (gracePcTs) {
    await db.exception.create({
      data: {
        timesheetId: gracePcTs.id,
        exceptionType: "MISSING_PUNCH",
        description: "Missing clock-out punch on Feb 10, 2026",
        occurredAt: new Date("2026-02-10T17:00:00"),
      },
    });
  }
  if (henryPcTs) {
    await db.exception.create({
      data: {
        timesheetId: henryPcTs.id,
        exceptionType: "LONG_SHIFT",
        description: "Shift exceeded 12 hours on Feb 6, 2026 (12h 45m)",
        occurredAt: new Date("2026-02-06T08:00:00"),
      },
    });
  }
  console.log("✓ Exceptions: MISSING_PUNCH (Grace), LONG_SHIFT (Henry)");

  // ── 10. Documents ─────────────────────────────────────────────────────────────
  const docDefs = [
    { title: "Offer Letter",              fileType: "application/pdf", fileUrl: "https://example.com/docs/offer-letter.pdf"     },
    { title: "W-4 Tax Withholding 2026",  fileType: "application/pdf", fileUrl: "https://example.com/docs/w4-2026.pdf"          },
    { title: "Direct Deposit Auth",       fileType: "application/pdf", fileUrl: "https://example.com/docs/direct-deposit.pdf"   },
    { title: "Employee Handbook Receipt", fileType: "application/pdf", fileUrl: "https://example.com/docs/handbook-receipt.pdf" },
  ];
  const docData = EMP_DEFS.flatMap((def) =>
    docDefs.slice(0, def.role === "EMPLOYEE" ? 3 : 4).map((doc) => ({
      employeeId: empMap[def.id],
      title: doc.title,
      fileUrl: doc.fileUrl,
      fileType: doc.fileType,
      uploadedBy: empMap["emp-seed-01"],
    }))
  );
  await db.document.createMany({ data: docData });
  console.log(`✓ Documents: ${docData.length} files across ${EMP_DEFS.length} employees`);

  // ── 11. Sample Audit Logs ─────────────────────────────────────────────────────
  await db.auditLog.createMany({
    data: [
      { actorId: empMap["emp-seed-01"], action: "EMPLOYEE_CREATED",          entityType: "EMPLOYEE",   entityId: empMap["emp-seed-06"], createdAt: subDays(new Date(), 60) },
      { actorId: empMap["emp-seed-01"], action: "EMPLOYEE_CREATED",          entityType: "EMPLOYEE",   entityId: empMap["emp-seed-07"], createdAt: subDays(new Date(), 58) },
      { actorId: empMap["emp-seed-03"], action: "TIMESHEET_PAYROLL_APPROVED", entityType: "TIMESHEET",  entityId: "seed",               createdAt: subDays(new Date(), 25) },
      { actorId: empMap["emp-seed-04"], action: "TIMESHEET_SUP_APPROVED",    entityType: "TIMESHEET",  entityId: "seed",               createdAt: subDays(new Date(), 26) },
      { actorId: empMap["emp-seed-05"], action: "EXCEPTION_RESOLVED",        entityType: "TIMESHEET",  entityId: "seed",               createdAt: subDays(new Date(), 20) },
      { actorId: empMap["emp-seed-03"], action: "LOCK",                      entityType: "PAY_PERIOD", entityId: ppA.id,               createdAt: subDays(new Date(), 28) },
    ],
  });
  console.log("✓ Audit Logs: 6 sample entries");

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Seed complete!

  Login credentials:
    admin / admin123         (System Admin)
    hr.johnson / password123 (HR Admin)
    payroll.bob / password123 (Payroll Admin)
    sup.carol / password123  (Supervisor – Engineering)
    sup.david / password123  (Supervisor – Warehouse)
    emp.emily / password123  (Employee)
    emp.frank / password123  (Employee)
    emp.grace / password123  (Employee)
    emp.henry / password123  (Employee)
    emp.iris  / password123  (Employee)
    emp.james / password123  (Employee)

  Things to explore:
    • Punch Clock   — log in as emp.emily, clock in/out
    • Supervisor    — log in as sup.carol, approve Emily & Frank timesheets
    • Payroll       — log in as payroll.bob, approve Henry (SUP_APPROVED)
    • Leave         — Emily has a PENDING leave request waiting for Carol
    • Exceptions    — Grace has MISSING_PUNCH, Henry has LONG_SHIFT
    • Reports       — view hours for any locked/ready pay period
    • Admin         — manage employees, sites, rule sets
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); await pool.end(); });
