/**
 * A schedule as a sentence, on a 12 hour clock: "Every day at 8:00 AM EDT",
 * "On the last day of each month at 8:00 PM EDT".
 *
 * <p>Only the shapes the schedule form builds are put in words. A hand
 * written one is shown as it is, since a wrong sentence about when a payroll
 * report goes out is worse than none.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function timezoneAbbr(timezone: string, at: Date = new Date()): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

export function describeSchedule(expr: string, timezone: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hr, dom, mon, dow] = parts;
  const h = Number(hr);
  const m = Number(min);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return expr;
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  const zone = timezoneAbbr(timezone);
  const time = `${clock}${zone ? ` ${zone}` : ""}`;
  const dayNumber = Number(dom);

  if (mon === "*") {
    if (dom === "*" && dow === "*") return `Every day at ${time}`;
    if (dom === "*" && DAY_NAMES[Number(dow)]) return `Every ${DAY_NAMES[Number(dow)]} at ${time}`;
    if (dom === "1,15" && dow === "*") return `On the 1st and 15th at ${time}`;
    if (dom === "L" && dow === "*") return `On the last day of each month at ${time}`;
    if (dow === "*" && Number.isInteger(dayNumber)) return `On the ${ordinal(dayNumber)} of each month at ${time}`;
    return expr;
  }
  const monthNumber = Number(mon);
  if (dow === "*" && Number.isInteger(dayNumber) && MONTH_NAMES[monthNumber - 1]) {
    return `Every year on ${MONTH_NAMES[monthNumber - 1]} ${dayNumber} at ${time}`;
  }
  return expr;
}
