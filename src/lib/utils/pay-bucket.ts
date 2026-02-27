/**
 * Client-safe PayBucket label and color maps.
 * Mirrors the Prisma PayBucket enum without importing @prisma/client.
 */

export type PayBucketValue =
  | "REG"
  | "OT"
  | "DT"
  | "PTO"
  | "SICK"
  | "HOLIDAY"
  | "FMLA"
  | "BEREAVEMENT"
  | "JURY_DUTY"
  | "MILITARY"
  | "UNPAID";

export const PAY_BUCKET_LABEL: Record<PayBucketValue, string> = {
  REG: "Regular",
  OT: "Overtime",
  DT: "Double Time",
  PTO: "PTO",
  SICK: "Sick",
  HOLIDAY: "Holiday",
  FMLA: "FMLA",
  BEREAVEMENT: "Bereavement",
  JURY_DUTY: "Jury Duty",
  MILITARY: "Military",
  UNPAID: "Unpaid",
};

export const PAY_BUCKET_COLOR: Record<PayBucketValue, string> = {
  REG: "text-zinc-900 dark:text-white",
  OT: "text-amber-600 dark:text-amber-400",
  DT: "text-red-600 dark:text-red-400",
  PTO: "text-blue-600 dark:text-blue-400",
  SICK: "text-purple-600 dark:text-purple-400",
  HOLIDAY: "text-green-600 dark:text-green-400",
  FMLA: "text-zinc-500 dark:text-zinc-400",
  BEREAVEMENT: "text-zinc-500 dark:text-zinc-400",
  JURY_DUTY: "text-zinc-500 dark:text-zinc-400",
  MILITARY: "text-zinc-500 dark:text-zinc-400",
  UNPAID: "text-zinc-400 dark:text-zinc-500",
};

export const ALL_PAY_BUCKETS: {
  key: PayBucketValue;
  label: string;
  color: string;
}[] = Object.entries(PAY_BUCKET_LABEL).map(([key, label]) => ({
  key: key as PayBucketValue,
  label,
  color: PAY_BUCKET_COLOR[key as PayBucketValue],
}));
