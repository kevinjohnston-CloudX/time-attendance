import { sendMail } from "@/lib/email/send-mail";
import { generateReportEmailHtml } from "./templates";

export { isEmailConfigured } from "@/lib/email/send-mail";

interface SendReportParams {
  recipients: string[];
  reportName: string;
  format: string;
  fileBuffer: Buffer;
  rowCount: number;
  /** Rows actually in the file, when fewer than the report found. */
  shownRows?: number;
  /** The file's name without its extension. Falls back to the report's name. */
  fileStem?: string;
  /** The days the report covers, in words, for the subject and the message. */
  periodLabel?: string;
  /** The product's name, put first in the subject so the sender is plain. */
  brand?: string | null;
}

/**
 * Sends one report to its recipients. Throws when email is not set up or the
 * mail service refuses, so a send that did not happen is never recorded as one
 * that did: the schedule's run history says what went wrong.
 */
export async function sendReportEmail({
  recipients,
  reportName,
  format,
  fileBuffer,
  rowCount,
  shownRows,
  fileStem,
  periodLabel,
  brand,
}: SendReportParams): Promise<void> {
  const ext = format.toLowerCase();
  const mimeTypes: Record<string, string> = {
    csv: "text/csv",
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  const safeName = fileStem ?? reportName.replace(/[^a-z0-9]/gi, "-");
  const subject = `${brand ? `${brand} ` : ""}${reportName}${periodLabel ? `, ${periodLabel}` : ""}`;

  await sendMail({
    to: recipients,
    subject,
    html: generateReportEmailHtml({ reportName, rowCount, shownRows, format, generatedAt: new Date(), periodLabel }),
    attachments: [{ content: fileBuffer, filename: `${safeName}.${ext}`, type: mimeTypes[ext] || "application/octet-stream" }],
  });
}
