import { Resend } from "resend";

const SUBJECT = "Sign in to My Stash Jar";
const PLAIN_BODY = `Your sign-in link

Click to sign in. This link expires in 15 minutes. If you didn't request it, you can ignore this email.

Sign in: {{link}}`;

function htmlBody(link: string): string {
  const escaped = link
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 1.25rem; font-weight: 600;">Your sign-in link</h1>
  <p>Click to sign in. This link expires in 15 minutes. If you didn't request it, you can ignore this email.</p>
  <p style="margin: 24px 0;">
    <a href="${escaped}" style="display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 500;">Sign in</a>
  </p>
  <p style="font-size: 0.875rem; color: #666; word-break: break-all;">Or copy this link: <a href="${escaped}">${escaped}</a></p>
</body>
</html>`;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Sends the magic link email via Resend.
 * Uses RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO from env.
 * Returns { ok: true } on success; on failure returns { ok: false, error } so caller can log and still respond 200 (no enumeration).
 */
export async function sendMagicLinkEmail(email: string, link: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    return { ok: false, error: "RESEND_API_KEY or EMAIL_FROM not set" };
  }
  const resend = new Resend(apiKey);
  const text = PLAIN_BODY.replace("{{link}}", link);
  const payload: { from: string; to: string[]; subject: string; html: string; text: string; replyTo?: string } = {
    from,
    to: [email],
    subject: SUBJECT,
    html: htmlBody(link),
    text,
  };
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  if (replyTo) payload.replyTo = replyTo;

  const { data, error } = await resend.emails.send(payload);
  if (error) {
    return { ok: false, error: typeof error === "object" ? JSON.stringify(error) : String(error) };
  }
  if (data?.id) {
    return { ok: true };
  }
  return { ok: false, error: "No id in Resend response" };
}
