import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A photo taken with a scan shows on the next reload, not at the next 15
 * minute listing of the bucket (Juan, 2026-11-17).
 */

const bucket = new Map<string, number>(); // file name -> last modified
const sent: { type: string; key?: string }[] = [];
const recentScans: { employeeId: string; badgeCode: string; scanTime: Date }[] = [];

vi.mock("@aws-sdk/client-s3", () => {
  class Cmd {
    constructor(public input: { Key?: string }) {}
  }
  class ListObjectsV2Command extends Cmd {}
  class HeadObjectCommand extends Cmd {}
  class GetObjectCommand extends Cmd {}
  class S3Client {
    async send(cmd: Cmd) {
      if (cmd instanceof ListObjectsV2Command) {
        sent.push({ type: "list" });
        return { Contents: [...bucket].map(([Key, at]) => ({ Key, LastModified: new Date(at) })), IsTruncated: false };
      }
      if (cmd instanceof HeadObjectCommand) {
        sent.push({ type: "head", key: cmd.input.Key });
        const at = bucket.get(cmd.input.Key ?? "");
        if (at === undefined) throw new Error("NotFound");
        return { LastModified: new Date(at) };
      }
      throw new Error("unexpected command");
    }
  }
  return { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, CopyObjectCommand: Cmd, DeleteObjectCommand: Cmd, PutObjectCommand: Cmd };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_c: unknown, cmd: { input: { Key: string } }, o: { signingDate: Date }) => `signed:${cmd.input.Key}@${o.signingDate.getTime()}`,
}));
vi.mock("@/lib/privacy/data-protection", () => ({ photoOffIds: async () => new Set<string>() }));
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: async () => [],
    scanEvent: {
      findMany: async ({ where }: { where: { employeeId: { in: string[] }; scanTime: { gte: Date } } }) =>
        recentScans
          .filter((s) => where.employeeId.in.includes(s.employeeId) && s.scanTime >= where.scanTime.gte)
          .sort((a, b) => b.scanTime.getTime() - a.scanTime.getTime()),
    },
  },
}));

process.env.ON_SITE_PHOTOS_REGION = "us-east-1";
process.env.ON_SITE_PHOTOS_BUCKET = "photos";
process.env.ON_SITE_PHOTOS_ACCESS_KEY_ID = "test";
process.env.ON_SITE_PHOTOS_SECRET_ACCESS_KEY = "test";

const { photoUrls } = await import("./photos");

const veteran = { id: "e1", barcode: null, wmsId: "111111", employeeCode: "111111" };
const visitor = { id: "v1", barcode: null, wmsId: "CL00009", employeeCode: "CL00009" };
const nobody = { id: "n1", barcode: null, wmsId: "222222", employeeCode: "222222" };

describe("photos taken with a scan", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("shows a new visitor's photo on the first reload after the scan", async () => {
    bucket.set("111111.jpg", Date.now() - 86_400_000);
    // The listing is read before the visitor's photo exists.
    const before = await photoUrls("t1", [veteran, visitor, nobody]);
    expect(before.get("v1")).toBeNull();

    bucket.set("CL00009.jpg", Date.now());
    recentScans.push({ employeeId: "v1", badgeCode: "CL00009", scanTime: new Date() });
    const after = await photoUrls("t1", [veteran, visitor, nobody]);
    expect(after.get("v1")).toMatch(/^signed:CL00009\.jpg@/);
    // Only the person who just scanned is looked up; nobody else costs a request.
    expect(sent.filter((s) => s.type === "head").map((s) => s.key)).toEqual(["CL00009.jpg"]);
  });

  it("gives a retaken photo a new link, so the browser drops the old face", async () => {
    const first = (await photoUrls("t1", [veteran])).get("e1");
    bucket.set("111111.jpg", Date.now() + 1000);
    recentScans.push({ employeeId: "e1", badgeCode: "111111", scanTime: new Date() });
    const second = (await photoUrls("t1", [veteran])).get("e1");
    expect(second).toMatch(/^signed:111111\.jpg@/);
    expect(second).not.toBe(first);
  });

  it("leaves people who did not scan alone", async () => {
    const out = await photoUrls("t1", [nobody]);
    expect(out.get("n1")).toBeNull();
    expect(sent.filter((s) => s.type === "head")).toEqual([]);
  });
});
