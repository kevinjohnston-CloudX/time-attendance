interface ReportEmailParams {
  reportName: string;
  rowCount: number;
  /** Rows in the file, when the report had more than it could hold. */
  shownRows?: number;
  format: string;
  generatedAt: Date;
  periodLabel?: string;
}

/** A report's name is typed by a person, so it is escaped before it goes into HTML. */
function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function generateReportEmailHtml(params: ReportEmailParams): string {
  const { reportName, rowCount, shownRows, format, generatedAt, periodLabel } = params;
  const cut = shownRows !== undefined && shownRows < rowCount;
  const dateStr = generatedAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
      <div style="max-width: 560px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7;">
        <div style="padding: 32px;">
          <h1 style="margin: 0 0 8px; font-size: 18px; color: #18181b;">Scheduled Report Ready</h1>
          <p style="margin: 0 0 24px; font-size: 14px; color: #71717a;">Your scheduled report has been generated and is attached to this email.</p>

          <div style="background: #fafafa; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <table style="width: 100%; font-size: 14px; color: #3f3f46;">
              <tr>
                <td style="padding: 4px 0; font-weight: 600;">Report</td>
                <td style="padding: 4px 0; text-align: right;">${esc(reportName)}</td>
              </tr>${periodLabel ? `
              <tr>
                <td style="padding: 4px 0; font-weight: 600;">Period</td>
                <td style="padding: 4px 0; text-align: right;">${esc(periodLabel)}</td>
              </tr>` : ""}
              <tr>
                <td style="padding: 4px 0; font-weight: 600;">Rows</td>
                <td style="padding: 4px 0; text-align: right;">${cut ? `${shownRows!.toLocaleString("en-US")} of ${rowCount.toLocaleString("en-US")}` : rowCount.toLocaleString("en-US")}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; font-weight: 600;">Format</td>
                <td style="padding: 4px 0; text-align: right;">${format.toUpperCase()}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; font-weight: 600;">Generated</td>
                <td style="padding: 4px 0; text-align: right;">${dateStr}</td>
              </tr>
            </table>
          </div>

          ${cut ? `<p style="margin: 0 0 16px; font-size: 13px; color: #b45309;">This file holds the first ${shownRows!.toLocaleString("en-US")} of ${rowCount.toLocaleString("en-US")} rows. Open the report in CloudTime and raise its row limit to get the rest.</p>` : ""}
          <p style="margin: 0; font-size: 12px; color: #a1a1aa;">This is an automated email from CloudTime. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}
