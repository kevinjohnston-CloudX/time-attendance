/**
 * Whether the security gates decide admission from CloudTime's schedule.
 *
 * <p>Today they do not. A badge at the gate is checked by the tablet against
 * cajaapi, which reads Oracle's `dailyworkerschedule`, and CloudTime can only
 * read Oracle (see schedule-sync.service.ts). So a day added to the schedule
 * here changes what CloudTime shows and nothing about who the gate lets in.
 * CloudTime's own check, `/api/timeclock/eligibility`, reads this schedule,
 * but no tablet calls it yet.
 *
 * <p>Until one does, Live Attendance draws Add to schedule greyed out, and the
 * action behind it refuses, so nobody adds a day expecting a door to open.
 * Set `GATE_SCHEDULE_SOURCE=cloudtime` once the tablets ask CloudTime; that
 * one setting turns both on.
 */
export function gateReadsCloudTimeSchedule(): boolean {
  return process.env.GATE_SCHEDULE_SOURCE === "cloudtime";
}
