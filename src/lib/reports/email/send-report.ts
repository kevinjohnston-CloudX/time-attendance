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
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

export async function sendReportEmail({
  recipients,
  reportName,
  format,
  fileBuffer,
  rowCount,
}: SendReportParams): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn(
      "[reports] SendGrid not configured (SENDGRID_API_KEY missing) — skipping email for:",
      reportName
    );
    return;
  }

  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!fromEmail) {
    console.warn(
      "[reports] SendGrid not configured (SENDGRID_FROM_EMAIL missing) — skipping email for:",
      reportName
    );
    return;
  }

  const ext = format.toLowerCase();
  const mimeTypes: Record<string, string> = {
    csv: "text/csv",
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  const safeName = reportName.replace(/[^a-z0-9]/gi, "-");

  const msg = {
    to: recipients,
    from: fromEmail,
    subject: `Scheduled Report: ${reportName}`,
    html: generateReportEmailHtml({ reportName, rowCount, format, generatedAt: new Date() }),
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
