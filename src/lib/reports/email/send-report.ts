import sgMail from "@sendgrid/mail";
import { generateReportEmailHtml } from "./templates";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

interface SendReportParams {
  recipients: string[];
  reportName: string;
  format: string;
  fileBuffer: Buffer;
  rowCount: number;
  /** The file's name without its extension. Falls back to the report's name. */
  fileStem?: string;
  /** The days the report covers, in words, for the subject and the message. */
  periodLabel?: string;
  /** The product's name, put first in the subject so the sender is plain. */
  brand?: string | null;
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
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
  fileStem,
  periodLabel,
  brand,
}: SendReportParams): Promise<void> {
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!process.env.SENDGRID_API_KEY || !fromEmail) {
    throw new Error("Email is not set up on this server, so nothing was sent.");
  }

  const ext = format.toLowerCase();
  const mimeTypes: Record<string, string> = {
    csv: "text/csv",
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  const safeName = fileStem ?? reportName.replace(/[^a-z0-9]/gi, "-");
  const subject = `${brand ? `${brand} ` : ""}${reportName}${periodLabel ? `, ${periodLabel}` : ""}`;

  const msg = {
    to: recipients,
    from: fromEmail,
    subject,
    html: generateReportEmailHtml({ reportName, rowCount, format, generatedAt: new Date(), periodLabel }),
    attachments: [
      {
        content: fileBuffer.toString("base64"),
        filename: `${safeName}.${ext}`,
        type: mimeTypes[ext] || "application/octet-stream",
        disposition: "attachment" as const,
      },
    ],
  };

  await sgMail.send(msg);
}
