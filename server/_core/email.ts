/**
 * server/_core/email.ts
 *
 * Transactional email helper for NEXCOM Exchange.
 *
 * Priority order:
 *  1. SendGrid  — set SENDGRID_API_KEY
 *  2. SMTP      — set SMTP_HOST (+ optional SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE)
 *  3. Stub      — logs to console in development, no-op in test (NODE_ENV=test)
 *
 * Usage:
 *   import { sendEmail } from "./_core/email";
 *   await sendEmail({ to: "user@example.com", subject: "Your OTP", text: "Code: 123456", html: "<b>Code: 123456</b>" });
 */

import nodemailer from "nodemailer";

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

export interface EmailResult {
  ok: boolean;
  provider: "sendgrid" | "smtp" | "stub";
  messageId?: string;
  error?: string;
}

// ─── SendGrid delivery ────────────────────────────────────────────────────────
async function sendViaSendGrid(payload: EmailPayload): Promise<EmailResult> {
  const apiKey = process.env.SENDGRID_API_KEY!;
  const from = payload.from ?? process.env.EMAIL_FROM ?? "noreply@nexcom.exchange";

  const body = {
    personalizations: [{ to: [{ email: payload.to }] }],
    from: { email: from },
    subject: payload.subject,
    content: [
      { type: "text/plain", value: payload.text },
      ...(payload.html ? [{ type: "text/html", value: payload.html }] : []),
    ],
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    return { ok: true, provider: "sendgrid", messageId: res.headers.get("x-message-id") ?? undefined };
  }
  const errText = await res.text().catch(() => res.statusText);
  return { ok: false, provider: "sendgrid", error: `SendGrid ${res.status}: ${errText}` };
}

// ─── SMTP delivery ────────────────────────────────────────────────────────────
let _smtpTransport: nodemailer.Transporter | null = null;

function getSmtpTransport(): nodemailer.Transporter {
  if (_smtpTransport) return _smtpTransport;
  const host = process.env.SMTP_HOST!;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  _smtpTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
  });
  return _smtpTransport;
}

async function sendViaSmtp(payload: EmailPayload): Promise<EmailResult> {
  const transport = getSmtpTransport();
  const from = payload.from ?? process.env.EMAIL_FROM ?? `NEXCOM Exchange <noreply@nexcom.exchange>`;
  try {
    const info = await transport.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    return { ok: true, provider: "smtp", messageId: info.messageId };
  } catch (err) {
    return { ok: false, provider: "smtp", error: String(err) };
  }
}

// ─── Public sendEmail function ────────────────────────────────────────────────
/**
 * Send a transactional email.
 * - In test environment (NODE_ENV=test): always returns ok=true without sending.
 * - In development without SMTP/SendGrid configured: logs to console.
 * - In production: uses SendGrid (if SENDGRID_API_KEY set) or SMTP (if SMTP_HOST set).
 */
export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  // ── Suppress in test environment ─────────────────────────────────────────
  if (process.env.NODE_ENV === "test") {
    return { ok: true, provider: "stub", messageId: "test-suppressed" };
  }

  // ── SendGrid ──────────────────────────────────────────────────────────────
  if (process.env.SENDGRID_API_KEY) {
    const result = await sendViaSendGrid(payload);
    if (!result.ok) {
      console.error("[Email] SendGrid delivery failed:", result.error);
    }
    return result;
  }

  // ── SMTP ──────────────────────────────────────────────────────────────────
  if (process.env.SMTP_HOST) {
    const result = await sendViaSmtp(payload);
    if (!result.ok) {
      console.error("[Email] SMTP delivery failed:", result.error);
    }
    return result;
  }

  // ── Development stub ──────────────────────────────────────────────────────
  console.info(
    `[Email] STUB — no SENDGRID_API_KEY or SMTP_HOST configured.\n` +
    `  To: ${payload.to}\n` +
    `  Subject: ${payload.subject}\n` +
    `  Body: ${payload.text.slice(0, 200)}`
  );
  return { ok: true, provider: "stub" };
}

/**
 * Send an OTP email with a consistent branded template.
 */
export async function sendOtpEmail(opts: {
  to: string;
  code: string;
  expiresMinutes?: number;
  userName?: string;
}): Promise<EmailResult> {
  const { to, code, expiresMinutes = 10, userName } = opts;
  const greeting = userName ? `Hello ${userName},` : "Hello,";

  const text =
    `${greeting}\n\n` +
    `Your NEXCOM Exchange security code is:\n\n` +
    `  ${code}\n\n` +
    `This code expires in ${expiresMinutes} minutes. Do not share it with anyone.\n` +
    `If you did not request this code, please secure your account immediately.\n\n` +
    `— The NEXCOM Exchange Security Team`;

  const html =
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">` +
    `<h2 style="color:#1a1a2e;margin-bottom:8px">NEXCOM Exchange</h2>` +
    `<p style="color:#444">${greeting}</p>` +
    `<p style="color:#444">Your security code is:</p>` +
    `<div style="background:#f4f4f8;border-radius:8px;padding:20px;text-align:center;` +
    `font-size:32px;font-weight:700;letter-spacing:8px;color:#1a1a2e;margin:16px 0">${code}</div>` +
    `<p style="color:#888;font-size:13px">This code expires in ${expiresMinutes} minutes.</p>` +
    `<p style="color:#888;font-size:13px">If you did not request this code, ` +
    `<a href="https://nexcom.exchange/security" style="color:#e63946">secure your account</a> immediately.</p>` +
    `<hr style="border:none;border-top:1px solid #eee;margin:24px 0">` +
    `<p style="color:#bbb;font-size:11px">NEXCOM Exchange · Do not reply to this email</p>` +
    `</div>`;

  return sendEmail({ to, subject: "Your NEXCOM Exchange security code", text, html });
}
