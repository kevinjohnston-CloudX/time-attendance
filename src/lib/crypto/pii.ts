import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const hex = process.env.EMPLOYEE_PII_ENCRYPTION_KEY;
  if (!hex) throw new Error("EMPLOYEE_PII_ENCRYPTION_KEY is not set");
  if (hex.length !== 64) throw new Error("EMPLOYEE_PII_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(hex, "hex");
}

/** Encrypt a plaintext string. Returns an opaque `iv:tag:ciphertext` hex string. */
export function encryptPii(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt a value produced by encryptPii. Returns null for null input or decryption failure. */
export function decryptPii(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const [ivHex, tagHex, dataHex] = value.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = getKey();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

const PII_FIELDS = [
  "phone", "phone2", "gender", "maritalStatus",
  "emergencyContact", "emergencyPhone", "emergencyRelationship",
  "address1", "address2", "city", "state", "country", "zipCode",
] as const;

type PiiField = (typeof PII_FIELDS)[number];
type WithPii = Partial<Record<PiiField, string | null>>;

/** Encrypt all PII fields in a data object before writing to DB. */
export function encryptPiiFields<T extends WithPii>(data: T): T {
  const result = { ...data };
  for (const field of PII_FIELDS) {
    if (field in result) {
      (result as WithPii)[field] = encryptPii((result as WithPii)[field]);
    }
  }
  return result;
}

/** Decrypt all PII fields in a record returned from DB. */
export function decryptPiiFields<T extends WithPii>(record: T): T {
  const result = { ...record };
  for (const field of PII_FIELDS) {
    if (field in result) {
      (result as WithPii)[field] = decryptPii((result as WithPii)[field]);
    }
  }
  return result;
}
