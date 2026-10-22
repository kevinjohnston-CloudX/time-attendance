import { NextRequest, NextResponse } from "next/server";
import { codeOf } from "@/lib/action-errors";

/**
 * The GET routes Live Attendance reads through while it is open: the board,
 * the scan log, movements, gate alerts, tablets and unknown badges.
 *
 * <p>Each route only hands its question to the server action that already
 * answers it, so the permission, the building check and every rule about
 * the input are the action's own, unchanged. What changes is the door: the
 * browser runs server actions one at a time, so a page that asks every few
 * seconds held up every click behind its own refreshes. A route is a plain
 * request, and runs alongside them. The writes stay server actions.
 *
 * <p>The question travels as JSON in `?input=`, the way tRPC sends a query,
 * and the answer is the action's own result, `{ success, data }` or
 * `{ success: false, error }`, so the page reads it exactly as it read the
 * action. Everything on these pages is strings and numbers, which JSON
 * carries as they are. Failures also set the status: 401 when signed out,
 * 404 for a building outside the viewer's list (FORBIDDEN or NOT_FOUND, the
 * same pair the action already tells the page apart), 500 otherwise.
 */

/** More than any of these questions ever is; the scan log with a full search is about 2 KB. */
const MAX_INPUT = 8_000;

type ActionResult = { success: true; data: unknown } | { success: false; error: string };

export function presenceRead<I>(action: (input: I) => Promise<ActionResult>) {
  return async function GET(req: NextRequest): Promise<NextResponse> {
    const headers = { "Cache-Control": "no-store" };
    const raw = req.nextUrl.searchParams.get("input") ?? "";
    let input: unknown;
    try {
      if (raw.length > MAX_INPUT) throw new Error("too long");
      input = JSON.parse(raw);
    } catch {
      return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 400, headers });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 400, headers });
    }
    const res = await action(input as I);
    if (res.success) return NextResponse.json(res, { headers });
    const status =
      codeOf(res) === "UNAUTHENTICATED" ? 401 : codeOf(res) === "FORBIDDEN" || codeOf(res) === "NOT_FOUND" ? 404 : 500;
    return NextResponse.json(res, { status, headers });
  };
}
