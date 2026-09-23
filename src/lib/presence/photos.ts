import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/lib/db";

/**
 * The time clock tablets' photos, one per person, kept in a private S3 bucket
 * under the person's 10 digit badge barcode: `0002362400.jpg`.
 *
 * <p>Server only. The browser never gets the key, only a link S3 signed for
 * one photo that stops working after a while, and only from an action that
 * has already checked the viewer may open On Site for that site. The bucket
 * stays private: a photo cannot be opened by guessing its address.
 *
 * <p>Links are signed against the start of a 30 minute window, so every
 * refresh inside that window hands out the same link and the browser shows
 * the photo it already has instead of downloading every face every 30
 * seconds. Each link lives two hours, so one handed out at the end of a
 * window still has an hour and a half left.
 *
 * <p>Nothing here checks that a photo exists: that would be one request to
 * AWS per person per refresh. A link to a photo that is not there fails in
 * the browser, which then shows the person's initials in the same frame.
 *
 * <p>Off entirely when the ON_SITE_PHOTOS_* settings are missing: every
 * photo is null and the page shows initials, as it did before.
 */

const WINDOW_MS = 30 * 60 * 1000;
const LINK_SECONDS = 2 * 60 * 60;
/** How long a person's photo name is remembered before it is looked up again. */
const KEY_CACHE_MS = 10 * 60 * 1000;
const BARCODE = /^[0-9]{10}$/;

let client: S3Client | null | undefined;

function s3(): { client: S3Client; bucket: string } | null {
  const { ON_SITE_PHOTOS_REGION, ON_SITE_PHOTOS_BUCKET, ON_SITE_PHOTOS_ACCESS_KEY_ID, ON_SITE_PHOTOS_SECRET_ACCESS_KEY } =
    process.env;
  if (!ON_SITE_PHOTOS_REGION || !ON_SITE_PHOTOS_BUCKET || !ON_SITE_PHOTOS_ACCESS_KEY_ID || !ON_SITE_PHOTOS_SECRET_ACCESS_KEY) {
    return null;
  }
  if (client === undefined) {
    client = new S3Client({
      region: ON_SITE_PHOTOS_REGION,
      credentials: { accessKeyId: ON_SITE_PHOTOS_ACCESS_KEY_ID, secretAccessKey: ON_SITE_PHOTOS_SECRET_ACCESS_KEY },
    });
  }
  return client ? { client, bucket: ON_SITE_PHOTOS_BUCKET } : null;
}

const keyCache = new Map<string, { key: string | null; at: number }>();

/**
 * Which photo belongs to each person: their barcode on file, or else the
 * 10 digit badge they last scanned with in the past 30 days, which is how
 * the tablet named the photo when it took it. Remembered for ten minutes.
 */
async function photoKeys(
  tenantId: string,
  people: { id: string; barcode: string | null }[],
): Promise<Map<string, string | null>> {
  const now = Date.now();
  const out = new Map<string, string | null>();
  const unknown: string[] = [];

  for (const p of people) {
    if (p.barcode && BARCODE.test(p.barcode)) {
      out.set(p.id, `${p.barcode}.jpg`);
      continue;
    }
    const hit = keyCache.get(p.id);
    if (hit && now - hit.at < KEY_CACHE_MS) out.set(p.id, hit.key);
    else unknown.push(p.id);
  }

  if (unknown.length) {
    const rows = await db.$queryRaw<{ employeeId: string; badgeCode: string }[]>`
      SELECT DISTINCT ON (s."employeeId") s."employeeId" AS "employeeId", s."badgeCode" AS "badgeCode"
      FROM   "scan_events" s
      WHERE  s."tenantId" = ${tenantId}
        AND  s."employeeId" = ANY(${unknown})
        AND  s."badgeCode" ~ '^[0-9]{10}$'
        AND  s."scanTime" >= ${new Date(now - 30 * 24 * 60 * 60 * 1000)}
      ORDER  BY s."employeeId", s."scanTime" DESC
    `;
    const found = new Map(rows.map((r) => [r.employeeId, `${r.badgeCode}.jpg`]));
    for (const id of unknown) {
      const key = found.get(id) ?? null;
      keyCache.set(id, { key, at: now });
      out.set(id, key);
    }
  }
  return out;
}

/** A signed photo link per person id, or null where there is no photo to point at. */
export async function photoUrls(
  tenantId: string,
  people: { id: string; barcode: string | null }[],
): Promise<Map<string, string | null>> {
  const store = s3();
  const out = new Map<string, string | null>();
  if (!store || people.length === 0) {
    for (const p of people) out.set(p.id, null);
    return out;
  }

  let keys: Map<string, string | null>;
  try {
    keys = await photoKeys(tenantId, people);
  } catch {
    // A failed lookup costs the faces, never the page.
    for (const p of people) out.set(p.id, null);
    return out;
  }

  const signingDate = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS);
  await Promise.all(
    people.map(async (p) => {
      const key = keys.get(p.id) ?? null;
      if (!key) return out.set(p.id, null);
      try {
        const url = await getSignedUrl(
          store.client,
          new GetObjectCommand({
            Bucket: store.bucket,
            Key: key,
            // Lets the browser keep the photo for the life of the link.
            ResponseCacheControl: "private, max-age=3600",
          }),
          { expiresIn: LINK_SECONDS, signingDate },
        );
        out.set(p.id, url);
      } catch {
        out.set(p.id, null);
      }
    }),
  );
  return out;
}
