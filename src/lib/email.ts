import "server-only";

import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/passwordReset";

type SendEmailParams = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

const fromAddress = process.env.EMAIL_FROM;
const resendApiKey = process.env.RESEND_API_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://still-point.me";

export async function sendEmail({ to, subject, text, html }: SendEmailParams) {
  if (!fromAddress || !resendApiKey) {
    console.info("Email delivery skipped; EMAIL_FROM and RESEND_API_KEY are not both configured.");
    return { delivered: false };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Email provider failed with status ${response.status}`);
  }

  return { delivered: true };
}

export async function sendPasswordResetEmail({ to, token }: { to: string; token: string }) {
  const resetUrl = new URL("/reset-password", appUrl);
  resetUrl.searchParams.set("token", token);
  const link = resetUrl.toString();

  const result = await sendEmail({
    to,
    subject: "Reset your Still Point password",
    text: `Use this link to reset your Still Point password. It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes:\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Use this link to reset your Still Point password. It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes:</p><p><a href="${link}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
  if (!result.delivered && process.env.NODE_ENV !== "production") {
    console.info(`Password reset link for local development: ${link}`);
  }
  return result;
}
