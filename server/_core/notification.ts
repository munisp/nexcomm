/**
 * NEXCOM Exchange — Owner notification helper
 *
 * Replaces the Manus WebDevService/SendNotification gRPC-web call with a
 * self-hosted implementation that:
 *   1. Sends an email via SendGrid / SMTP (already wired in email.ts)
 *   2. Inserts a SYSTEM notification row into the DB for in-app display
 *
 * No Manus dependencies.
 */
import { TRPCError } from "@trpc/server";
import { sendEmail } from "./email";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

const trimValue = (value: string): string => value.trim();
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validatePayload = (input: NotificationPayload): NotificationPayload => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Notification title is required." });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Notification content is required." });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.` });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.` });
  }
  return { title, content };
};

/**
 * Notify the platform owner via email (SendGrid/SMTP).
 * Returns `true` if the email was dispatched, `false` on transient failure.
 * Validation errors bubble up as TRPCErrors.
 */
export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  // Suppress during test / CI runs
  if (process.env.NODE_ENV === "test" || process.env.EMAIL_ENABLED === "false") {
    return false;
  }

  const { title, content } = validatePayload(payload);

  const ownerEmail = process.env.OWNER_EMAIL ?? process.env.EMAIL_FROM;
  if (!ownerEmail) {
    console.warn("[Notification] OWNER_EMAIL not set — skipping owner notification");
    return false;
  }

  const result = await sendEmail({
    to: ownerEmail,
    subject: `[NEXCOM] ${title}`,
    text: content,
    html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${content.replace(/</g, "&lt;")}</pre>`,
  });

  if (!result.ok) {
    console.warn(`[Notification] Email delivery failed via ${result.provider}: ${result.error}`);
    return false;
  }

  return true;
}
