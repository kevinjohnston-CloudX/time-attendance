import sgMail from "@sendgrid/mail";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

export async function sendPasswordInviteEmail({
  to,
  name,
  token,
  appUrl,
}: {
  to: string;
  name: string;
  token: string;
  appUrl: string;
}): Promise<{ sent: boolean }> {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn("[invite] SendGrid not configured — skipping invite email to:", to);
    return { sent: false };
  }

  const setupUrl = `${appUrl}/setup-password?token=${token}`;

  await sgMail.send({
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: "Set up your TimeAtten account",
    text: `Hi ${name},\n\nYou've been invited to TimeAtten. Click the link below to set your password. This link expires in 24 hours and can only be used once.\n\n${setupUrl}\n\nIf you didn't expect this email, you can ignore it.`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#1e293b;margin-bottom:8px">Set up your TimeAtten account</h2>
        <p style="color:#475569;margin-bottom:24px">Hi ${name},</p>
        <p style="color:#475569;margin-bottom:24px">
          You've been invited to TimeAtten. Click the button below to set your password.
          This link expires in <strong>24 hours</strong> and can only be used once.
        </p>
        <a href="${setupUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;margin-bottom:24px">
          Set my password
        </a>
        <p style="color:#94a3b8;font-size:13px">
          Or copy this link: <a href="${setupUrl}" style="color:#2563eb">${setupUrl}</a>
        </p>
        <p style="color:#94a3b8;font-size:12px;margin-top:32px">
          If you didn't expect this email, you can safely ignore it.
        </p>
      </div>
    `,
  });

  return { sent: true };
}
