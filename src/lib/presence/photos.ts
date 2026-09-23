import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/lib/db";

/**
 * The time clock tablets' photos, one per person, kept in a private S3 bucket
 * under whichever badge the person scanned when the tablet took it: most are
 * the 6 digit badge number (`129728.jpg`), some the 10 digit barcode
 * (`2672196388.jpg`).
 *
 * <p>Because the name depends on the badge used, not on one field, the file
 * is found rather than guessed: the bucket's file names are listed every 15
 * minutes, and each person gets the first of their badges that has a file,
 * trying the badges they actually scanned with (most recent first), then
 * their badge number, their barcode and their employee code. If listing ever
 * stops being allowed, the most recently scanned badge is used as a best
 * guess and a missing photo falls back to initials in the browser.
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
 * <p>Off entirely when the ON_SITE_PHOTOS_* settings are missing: every
 * photo is null and the page shows initials, as it did before.
 */

const WINDOW_MS = 30 * 60 * 1000;
const LINK_SECONDS = 2 * 60 * 60;
/** How often the bucket's file names are read again, for new photos. */
const LIST_TTL_MS = 15 * 60 * 1000;
/** How long a person's badges are remembered before they are read again. */
const BADGE_CACHE_MS = 10 * 60 * 1000;
const EXTENSIONS = [".jpg", ".jpeg", ".png", ".JPG"];
/** A guard against a runaway listing, far above the few thousand files there are. */
const MAX_FILES = 200_000;

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

/* ── The bucket's file names ─────────────────────────────────────────────── */

let files: { names: Set<string>; at: number } | null = null;
let listing: Promise<void> | null = null;

async function readList(store: { client: S3Client; bucket: string }): Promise<void> {
  const names = new Set<string>();
  let token: string | undefined;
  do {
    const page = await store.client.send(
      new ListObjectsV2Command({ Bucket: store.bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of page.Contents ?? []) if (o.Key) names.add(o.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && names.size < MAX_FILES);
  files = { names, at: Date.now() };
}

/**
 * The file names, read once and then refreshed in the background, so no
 * request after the first waits on AWS. Null when listing is not allowed.
 */
async function fileNames(store: { client: S3Client; bucket: string }): Promise<Set<string> | null> {
  const stale = !files || Date.now() - files.at > LIST_TTL_MS;
  if (stale && !listing) {
    listing = readList(store)
      .catch(() => {
        // Keep the last list if there is one; without one, fall back to guessing.
      })
      .finally(() => {
        listing = null;
      });
  }
  if (!files && listing) await listing;
  return files?.names ?? null;
}

/* ── Which file is whose ─────────────────────────────────────────────────── */

export interface PhotoPerson {
  id: string;
  barcode: string | null;
  wmsId?: string | null;
  employeeCode?: string | null;
}

const badgeCache = new Map<string, { badges: string[]; at: number }>();

/** Each person's badges from their scans in the last 60 days, most recent first. */
async function scannedBadges(tenantId: string, ids: string[]): Promise<Map<string, string[]>> {
  const now = Date.now();
  const out = new Map<string, string[]>();
  const unknown: string[] = [];
  for (const id of ids) {
    const hit = badgeCache.get(id);
    if (hit && now - hit.at < BADGE_CACHE_MS) out.set(id, hit.badges);
    else unknown.push(id);
  }
  if (unknown.length) {
    const rows = await db.$queryRaw<{ employeeId: string; badgeCode: string }[]>`
      SELECT s."employeeId" AS "employeeId", s."badgeCode" AS "badgeCode"
      FROM   "scan_events" s
      WHERE  s."tenantId" = ${tenantId}
        AND  s."employeeId" = ANY(${unknown})
        AND  s."scanTime" >= ${new Date(now - 60 * 24 * 60 * 60 * 1000)}
      GROUP  BY s."employeeId", s."badgeCode"
      ORDER  BY s."employeeId", MAX(s."scanTime") DESC
    `;
    const found = new Map<string, string[]>();
    for (const r of rows) (found.get(r.employeeId) ?? found.set(r.employeeId, []).get(r.employeeId)!).push(r.badgeCode);
    for (const id of unknown) {
      const badges = found.get(id) ?? [];
      badgeCache.set(id, { badges, at: now });
      out.set(id, badges);
    }
  }
  return out;
}

async function photoKeys(
  tenantId: string,
  store: { client: S3Client; bucket: string },
  people: PhotoPerson[],
): Promise<Map<string, string | null>> {
  const [names, badges] = await Promise.all([fileNames(store), scannedBadges(tenantId, people.map((p) => p.id))]);
  const out = new Map<string, string | null>();
  for (const p of people) {
    const candidates = [
      ...(badges.get(p.id) ?? []),
      p.wmsId,
      p.barcode,
      p.employeeCode,
    ]
      .map((c) => c?.trim())
      .filter((c): c is string => !!c && /^[A-Za-z0-9_-]{1,40}$/.test(c));
    const unique = [...new Set(candidates)];
    let key: string | null = null;
    if (names) {
      outer: for (const c of unique)
        for (const ext of EXTENSIONS)
          if (names.has(c + ext)) {
            key = c + ext;
            break outer;
          }
    } else if (unique.length) {
      key = `${unique[0]}.jpg`;
    }
    out.set(p.id, key);
  }
  return out;
}

/** A signed photo link per person id, or null where there is no photo to point at. */
export async function photoUrls(tenantId: string, people: PhotoPerson[]): Promise<Map<string, string | null>> {
  const store = s3();
  const out = new Map<string, string | null>();
  if (!store || people.length === 0) {
    for (const p of people) out.set(p.id, null);
    return out;
  }

  let keys: Map<string, string | null>;
  try {
    keys = await photoKeys(tenantId, store, people);
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
