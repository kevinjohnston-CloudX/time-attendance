import { timingSafeEqual } from "node:crypto";

/**
 * Whether a request to a scheduled job carries the cron secret Vercel sends
 * (`Authorization: Bearer <CRON_SECRET>`).
 *
 * <p>Refuses everything when CRON_SECRET is not set. Two jobs compared the
 * header with `Bearer ${process.env.CRON_SECRET}`, which with the secret unset
 * is "Bearer undefined", a header anyone can send. Compared in constant time.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
