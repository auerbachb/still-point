import "server-only";

import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/passwordReset";

type SendEmailParams = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  devLogMessage?: string;
};

const fromAddress = process.env.EMAIL_FROM;
const resendApiKey = process.env.RESEND_API_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://still-point.me";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendEmail({ to, subject, text, html, devLogMessage }: SendEmailParams) {
  if (!fromAddress || !resendApiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email delivery is not configured");
    }
    console.info(devLogMessage ?? "Email delivery skipped; EMAIL_FROM and RESEND_API_KEY are not both configured.");
    return { delivered: false };
  }

  const timeoutSignal = AbortSignal.timeout(10_000);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: timeoutSignal,
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
  const escapedLink = escapeHtml(link);

  const result = await sendEmail({
    to,
    subject: "Reset your Still Point password",
    text: `Use this link to reset your Still Point password. It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes:\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Use this link to reset your Still Point password. It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes:</p><p><a href="${escapedLink}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    devLogMessage: `Password reset link for local development: ${link}`,
  });
  return result;
}
