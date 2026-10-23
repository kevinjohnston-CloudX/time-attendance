import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

/**
 * Every file name, with when it last changed. The date goes into each link's
 * signature (see `photoUrls`), so a photo replaced from CloudTime gets a new
 * link and the browser fetches it instead of showing the one it kept.
 */
let files: { names: Map<string, number>; at: number } | null = null;
let listing: Promise<void> | null = null;

async function readList(store: { client: S3Client; bucket: string }): Promise<void> {
  const names = new Map<string, number>();
  let token: string | undefined;
  do {
    const page = await store.client.send(
      new ListObjectsV2Command({ Bucket: store.bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of page.Contents ?? []) if (o.Key) names.set(o.Key, o.LastModified?.getTime() ?? 0);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && names.size < MAX_FILES);
  files = { names, at: Date.now() };
}

/**
 * The file names, read once and then refreshed in the background, so no
 * request after the first waits on AWS. Null when listing is not allowed.
 */
async function fileNames(store: { client: S3Client; bucket: string }): Promise<Map<string, number> | null> {
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

/** The names a person's photo could be filed under, in the order they are tried. */
function candidatesFor(p: PhotoPerson, scanned: string[]): string[] {
  const all = [...scanned, p.wmsId, p.barcode, p.employeeCode]
    .map((c) => c?.trim())
    .filter((c): c is string => !!c && /^[A-Za-z0-9_-]{1,40}$/.test(c));
  return [...new Set(all)];
}

async function photoKeys(
  tenantId: string,
  store: { client: S3Client; bucket: string },
  people: PhotoPerson[],
): Promise<Map<string, string | null>> {
  const [names, badges] = await Promise.all([fileNames(store), scannedBadges(tenantId, people.map((p) => p.id))]);
  const out = new Map<string, string | null>();
  for (const p of people) {
    const unique = candidatesFor(p, badges.get(p.id) ?? []);
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

  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  await Promise.all(
    people.map(async (p) => {
      const key = keys.get(p.id) ?? null;
      if (!key) return out.set(p.id, null);
      // A photo changed inside this window is signed from when it changed, so
      // its link differs from the one the browser already holds.
      const changed = files?.names.get(key) ?? 0;
      const signingDate = new Date(Math.max(windowStart, changed));
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

/* ── Replacing a photo from CloudTime ────────────────────────────────────── */

/** The largest upload taken. The browser sends about a tenth of this. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export interface SavedPhoto {
  key: string;
  versionId: string | null;
  previousVersionId: string | null;
  url: string | null;
}

/**
 * Files a new photo for a person where the lookup above will find it first:
 * over the photo they have now (as a .jpg beside it when theirs is another
 * type, since .jpg is tried first), or, with none, under the badge they
 * scanned with last. The bucket keeps every version, so the photo it
 * replaces is not lost, and its version id goes back for the audit log.
 *
 * <p>Takes only a JPEG, checked by its first bytes rather than by what the
 * browser says it is. Nothing here reads the pixels, so it costs the server
 * no more than passing the file on.
 */
export async function savePhoto(tenantId: string, person: PhotoPerson, bytes: Uint8Array): Promise<SavedPhoto> {
  const store = s3();
  if (!store) throw new Error("PHOTOS_OFF");
  if (bytes.length < 1024 || bytes.length > MAX_PHOTO_BYTES) throw new Error("PHOTO_SIZE");
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new Error("PHOTO_TYPE");

  // Always the freshest view of the bucket and of their badges: a photo
  // filed under the wrong name is a person who keeps showing initials.
  badgeCache.delete(person.id);
  const [names, badges] = await Promise.all([fileNames(store), scannedBadges(tenantId, [person.id])]);
  const candidates = candidatesFor(person, badges.get(person.id) ?? []);
  const current = (await photoKeys(tenantId, store, [person])).get(person.id) ?? null;
  const base = current && names?.has(current) ? current.replace(/\.[^.]+$/, "") : candidates[0];
  if (!base) throw new Error("NO_BADGE");
  const key = `${base}.jpg`;

  let previousVersionId: string | null = null;
  try {
    const head = await store.client.send(new HeadObjectCommand({ Bucket: store.bucket, Key: key }));
    previousVersionId = head.VersionId ?? null;
  } catch {
    // Nothing there yet.
  }

  const put = await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: bytes,
      ContentType: "image/jpeg",
      Metadata: { source: "cloudtime" },
    }),
  );

  const changedAt = Date.now();
  files?.names.set(key, changedAt);
  const url = await getSignedUrl(
    store.client,
    new GetObjectCommand({ Bucket: store.bucket, Key: key, ResponseCacheControl: "private, max-age=3600" }),
    { expiresIn: LINK_SECONDS, signingDate: new Date(changedAt) },
  ).catch(() => null);

  return { key, versionId: put.VersionId ?? null, previousVersionId, url };
}

/* ── Removing a photo from CloudTime ─────────────────────────────────────── */

/** Where a removed photo is kept: never a name the lookup, the WMS or a tablet reads. */
const REMOVED_PREFIX = "removed/";

export interface RemovedPhoto {
  /** Each file taken away, and where its copy was kept. */
  removed: { key: string; savedAs: string }[];
  /** Files left in place because another employee could own the same name. */
  kept: string[];
}

/**
 * Takes a person's photo away, so CloudTime shows their initials and the next
 * time clock scan, which takes a photo for a badge that has none, takes a new
 * one. Every file that is theirs goes, not only the one shown first, or the
 * next one would simply appear in its place.
 *
 * <p>Nothing is lost: each file is copied under `removed/` first (a name
 * nothing else reads), and only then deleted. A file whose name another
 * employee could also own (their badge, barcode or employee code, or a badge
 * they scanned with lately) is left alone and reported, because removing it
 * could take somebody else's photo.
 *
 * <p>Works from a fresh read of the bucket, never the 15 minute list, so a
 * photo a tablet took a minute ago is not missed. If the bucket cannot be read
 * nothing is removed.
 */
export async function removePhoto(tenantId: string, person: PhotoPerson): Promise<RemovedPhoto> {
  const store = s3();
  if (!store) throw new Error("PHOTOS_OFF");
  badgeCache.delete(person.id);
  await readList(store).catch(() => {
    throw new Error("PHOTOS_UNREADABLE");
  });
  const names = files?.names;
  if (!names) throw new Error("PHOTOS_UNREADABLE");

  const badges = (await scannedBadges(tenantId, [person.id])).get(person.id) ?? [];
  const mine: { key: string; name: string; ext: string }[] = [];
  for (const name of candidatesFor(person, badges))
    for (const ext of EXTENSIONS) if (names.has(name + ext)) mine.push({ key: name + ext, name, ext });
  if (mine.length === 0) return { removed: [], kept: [] };

  // Names someone else could own, in any company: the bucket is shared.
  const wanted = [...new Set(mine.map((m) => m.name))];
  const shared = await db.$queryRaw<{ name: string }[]>`
    SELECT e."employeeCode" AS name FROM employees e WHERE e.id <> ${person.id} AND e."employeeCode" = ANY(${wanted})
    UNION SELECT e."wmsId" FROM employees e WHERE e.id <> ${person.id} AND e."wmsId" = ANY(${wanted})
    UNION SELECT e.barcode FROM employees e WHERE e.id <> ${person.id} AND e.barcode = ANY(${wanted})
    UNION SELECT s."badgeCode" FROM scan_events s
      WHERE s."badgeCode" = ANY(${wanted}) AND s."employeeId" IS NOT NULL AND s."employeeId" <> ${person.id}
        AND s."scanTime" >= ${new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)}`;
  const notOnlyTheirs = new Set(shared.map((r) => r.name));

  const out: RemovedPhoto = { removed: [], kept: [] };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const m of mine) {
    if (notOnlyTheirs.has(m.name)) {
      out.kept.push(m.key);
      continue;
    }
    const savedAs = `${REMOVED_PREFIX}${m.name}-${stamp}${m.ext}`;
    await store.client.send(
      new CopyObjectCommand({
        Bucket: store.bucket,
        Key: savedAs,
        CopySource: `${store.bucket}/${encodeURIComponent(m.key)}`,
        MetadataDirective: "REPLACE",
        ContentType: m.ext === ".png" ? "image/png" : "image/jpeg",
        Metadata: { source: "cloudtime", removedfrom: m.key },
      }),
    );
    await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: m.key }));
    names.delete(m.key);
    out.removed.push({ key: m.key, savedAs });
  }
  return out;
}
