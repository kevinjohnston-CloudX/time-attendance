import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * The phone app registers its notification address here (src/lib/native-app.ts).
 *
 * <p>Signed in only, and a person only ever adds or removes their own phone.
 * An address already held by someone else moves to whoever signed in on that
 * phone last, so a shared phone never gets the previous person's
 * notifications. Anything else answers 404.
 */

const body = z.object({
  token: z.string().min(1).max(4096),
  platform: z.enum(["IOS", "ANDROID"]).optional(),
});

async function caller() {
  const session = await auth();
  if (!session?.user?.id || session.user.isActive === false) return null;
  return session.user.id;
}

async function parse(request: Request) {
  // JSON only: a form posted from another site cannot reach this.
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  const parsed = body.safeParse(await request.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

export async function POST(request: Request) {
  const userId = await caller();
  const input = await parse(request);
  if (!userId || !input?.platform) return new Response(null, { status: 404 });
  await db.pushDevice.upsert({
    where: { token: input.token },
    create: { userId, token: input.token, platform: input.platform },
    update: { userId, platform: input.platform, lastSeenAt: new Date() },
  });
  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request) {
  const userId = await caller();
  const input = await parse(request);
  if (!userId || !input) return new Response(null, { status: 404 });
  await db.pushDevice.deleteMany({ where: { token: input.token, userId } });
  return new Response(null, { status: 204 });
}
