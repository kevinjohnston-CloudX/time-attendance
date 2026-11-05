import { db } from "@/lib/db";
import { sendApns } from "./apns";
import { sendFcm } from "./fcm";
import type { PushMessage, SendResult } from "./types";

/**
 * Sends one message to every phone these people have the app on. Never
 * throws: a notification that does not arrive must never undo or fail the
 * action that caused it. A phone Apple or Google says is gone is removed.
 */
export async function pushToUsers(userIds: string[], message: PushMessage): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return;
  try {
    const devices = await db.pushDevice.findMany({ where: { userId: { in: ids } }, select: { id: true, token: true, platform: true } });
    const results = await Promise.all(
      devices.map(async (d): Promise<{ id: string; result: SendResult | "failed" }> => {
        try {
          const result = d.platform === "IOS" ? await sendApns(d.token, message) : await sendFcm(d.token, message);
          return { id: d.id, result };
        } catch (e) {
          console.error("[push] not delivered:", e instanceof Error ? e.message : e);
          return { id: d.id, result: "failed" };
        }
      }),
    );
    const gone = results.filter((r) => r.result === "gone").map((r) => r.id);
    if (gone.length > 0) await db.pushDevice.deleteMany({ where: { id: { in: gone } } });
  } catch (e) {
    console.error("[push] skipped:", e instanceof Error ? e.message : e);
  }
}
