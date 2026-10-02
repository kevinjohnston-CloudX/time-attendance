/**
 * One line per step of the gate alert, all under one prefix, so a single log
 * search ("[gate-alert]") follows a badge from the gate check to the card on
 * Live Attendance to Dismiss or Add to schedule.
 *
 * <p>Steps, in the order they happen: `check` (the gate asked CloudTime),
 * `noted` (a refusal was kept), `unplaced` (a refusal with no building to put
 * it in), `dismissed`, `scheduled`, `switched` (a System Admin turned the
 * alert on or off in one building), and `failed` for anything that went wrong along the way. Values are ids, codes and times, never names.
 */
export function gateLog(
  step: string,
  fields: Record<string, string | number | boolean | null | undefined>,
  level: "info" | "warn" | "error" = "info",
): void {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" && /[\s"=]/.test(v) ? JSON.stringify(v) : String(v)}`);
  console[level](["[gate-alert]", step, ...parts].join(" "));
}

/** The error code an action throws, or the message of anything else. */
export function errorCode(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
}
