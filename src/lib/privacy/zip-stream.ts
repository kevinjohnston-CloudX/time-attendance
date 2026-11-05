import { once } from "node:events";
import { crc32, createDeflateRaw } from "node:zlib";

/**
 * A ZIP file written as it goes, for downloads too big to build in memory
 * (the company export). Each entry is compressed by zlib, which works off the
 * main thread, and handed on chunk by chunk, so memory stays flat whatever
 * the size. Sizes and checksums follow each entry (a data descriptor), which
 * every unzip tool reads. Up to 4 GB in all; past that it stops with an error
 * rather than write a file nothing can open.
 */

const LIMIT = 0xffffffff;

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

type Entry = { name: Buffer; crc: number; compressed: number; size: number; offset: number; time: number; date: number };

export class ZipStream {
  private offset = 0;
  private entries: Entry[] = [];

  constructor(private readonly push: (chunk: Uint8Array) => Promise<void>) {}

  private async write(chunk: Uint8Array) {
    this.offset += chunk.length;
    if (this.offset > LIMIT) throw new Error("ZIP_TOO_LARGE");
    await this.push(chunk);
  }

  /** Adds one file, read from `source` as it is produced. */
  async add(name: string, source: AsyncIterable<Uint8Array | string>, at = new Date()): Promise<{ size: number }> {
    const nameBytes = Buffer.from(name, "utf8");
    const { time, date } = dosTime(at);
    const offset = this.offset;

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0808, 6); // sizes after the data, names in UTF-8
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt16LE(nameBytes.length, 26);
    await this.write(head);
    await this.write(nameBytes);

    let crc = 0;
    let size = 0;
    let compressed = 0;
    const deflate = createDeflateRaw({ level: 6 });
    const drained = (async () => {
      for await (const out of deflate as AsyncIterable<Buffer>) {
        compressed += out.length;
        await this.write(out);
      }
    })();
    try {
      for await (const part of source) {
        const chunk = typeof part === "string" ? Buffer.from(part, "utf8") : part;
        if (chunk.length === 0) continue;
        crc = crc32(chunk, crc);
        size += chunk.length;
        if (size > LIMIT) throw new Error("ZIP_TOO_LARGE");
        if (!deflate.write(chunk)) await once(deflate, "drain");
      }
      deflate.end();
    } catch (e) {
      deflate.destroy();
      await drained.catch(() => {});
      throw e;
    }
    await drained;

    const tail = Buffer.alloc(16);
    tail.writeUInt32LE(0x08074b50, 0);
    tail.writeUInt32LE(crc >>> 0, 4);
    tail.writeUInt32LE(compressed, 8);
    tail.writeUInt32LE(size, 12);
    await this.write(tail);

    this.entries.push({ name: nameBytes, crc: crc >>> 0, compressed, size, offset, time, date });
    return { size };
  }

  /** Writes the closing directory. Nothing can be added after. */
  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const rec = Buffer.alloc(46);
      rec.writeUInt32LE(0x02014b50, 0);
      rec.writeUInt16LE(20, 4);
      rec.writeUInt16LE(20, 6);
      rec.writeUInt16LE(0x0808, 8);
      rec.writeUInt16LE(8, 10);
      rec.writeUInt16LE(e.time, 12);
      rec.writeUInt16LE(e.date, 14);
      rec.writeUInt32LE(e.crc, 16);
      rec.writeUInt32LE(e.compressed, 20);
      rec.writeUInt32LE(e.size, 24);
      rec.writeUInt16LE(e.name.length, 28);
      rec.writeUInt32LE(e.offset, 42);
      await this.write(rec);
      await this.write(e.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
  }
}

/** One value as a CSV field (RFC 4180): quoted when it holds a comma, quote or line break. */
export function csvField(v: unknown): string {
  if (v == null) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function") s = String(v); // Decimal
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (values: unknown[]) => values.map(csvField).join(",") + "\r\n";
