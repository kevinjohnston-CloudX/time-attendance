import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { enterCompany, lastCompany } from "@/lib/super-admin/enter-company";

/**
 * A relative redirect. A full URL built from the request would say
 * "localhost" for a browser on 127.0.0.1 (Next rewrites it), where the
 * person is not signed in.
 */
const to = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } });

/**
 * A super admin with no company open goes straight back into the last one
 * they opened, instead of being asked again. A route rather than the page
 * because only a route or an action may set the company cookie. With no
 * last company (the first time, or it was removed), the picker.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPER_ADMIN") return to("/login");
  const tenantId = await lastCompany(session.user.id);
  if (tenantId && (await enterCompany(session.user.id, tenantId))) return to("/dashboard");
  return to("/super-admin?pick=1");
}
