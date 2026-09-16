import { timingSafeEqual } from "crypto";

/**
 * Shared-secret gate for the /api/bridge/* endpoints.
 *
 * <p>The same shape the ticketing bridge uses against this Oracle instance:
 * one secret, held as an environment variable here and in the bridge's own
 * config file, sent as a Bearer token. There is no key to issue and no
 * identity provider in the path, because the caller is a single known process
 * on a known machine rather than a population of clients.
 *
 * <p>An unset secret turns the endpoints off with a 503. A missing
 * configuration must never read as "let everybody in".
 */
export function bridgeAuthed(
  req: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.BRIDGE_SECRET;
  if (!secret) return { ok: false, status: 503, error: "bridge not configured" };

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  // Compared in constant time so a wrong secret cannot be found one character
  // at a time by timing the response.
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}
