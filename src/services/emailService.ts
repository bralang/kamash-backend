import { google } from "googleapis";
import { config } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface SendDiagnosisEmailParams {
  to: string;
  attachment: EmailAttachment;
}

// Placeholder copy carried over unchanged from the n8n workflow's surviving (non-test)
// send branch — real subject/body wording needs to come from the clinic, not be invented
// here. See migration plan "Open items".
const EMAIL_SUBJECT = "שלום מירי";
const EMAIL_BODY = "hello";

function getGmailClient() {
  const { GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN } = config;
  if (!GMAIL_OAUTH_CLIENT_ID || !GMAIL_OAUTH_CLIENT_SECRET || !GMAIL_OAUTH_REFRESH_TOKEN) {
    throw new HttpError(500, "Gmail OAuth credentials are not configured");
  }
  const oauth2Client = new google.auth.OAuth2(GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GMAIL_OAUTH_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

function buildRawMessage(to: string, attachment: EmailAttachment): string {
  const boundary = `kamash_${Date.now()}`;
  const lines = [
    `To: ${to}`,
    `Subject: ${encodeSubject(EMAIL_SUBJECT)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    EMAIL_BODY,
    "",
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    attachment.content.toString("base64"),
    "",
    `--${boundary}--`,
  ];
  const raw = Buffer.from(lines.join("\r\n"), "utf-8").toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendDiagnosisEmail({ to, attachment }: SendDiagnosisEmailParams): Promise<void> {
  const gmail = getGmailClient();
  const raw = buildRawMessage(to, attachment);
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}
