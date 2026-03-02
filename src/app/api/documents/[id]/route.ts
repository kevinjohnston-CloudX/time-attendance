import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac/permissions";
import { createSignedUrl } from "@/lib/supabase-storage";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const doc = await db.document.findUnique({
    where: { id },
    include: { employee: { select: { tenantId: true } } },
  });
  if (!doc) return new NextResponse("Not found", { status: 404 });

  // Resolve tenantId (with SUPER_ADMIN cookie override)
  let tenantId = session.user.tenantId ?? null;
  if (session.user.role === "SUPER_ADMIN") {
    const cookieStore = await cookies();
    const override = cookieStore.get(SUPER_ADMIN_TENANT_COOKIE)?.value;
    if (override) tenantId = override;
  }

  // Permission gate
  if (hasPermission(session.user.role, "DOCUMENT_VIEW_ANY")) {
    if (doc.employee.tenantId !== tenantId) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  } else if (hasPermission(session.user.role, "DOCUMENT_VIEW_OWN")) {
    if (doc.employeeId !== session.user.employeeId) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  } else {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const signedUrl = await createSignedUrl(doc.fileUrl);
    return NextResponse.redirect(signedUrl, 302);
  } catch {
    return new NextResponse("Failed to generate download link", { status: 500 });
  }
}
