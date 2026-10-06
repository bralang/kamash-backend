import { randomUUID } from "node:crypto";
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

// Wording supplied by the clinic — reproduce it verbatim, don't edit it here.
export const EMAIL_SUBJECT = 'סיכום אבחון קמ"ש';

// The body is kept as structure rather than as a string so the plain-text and HTML parts are
// rendered from one source and cannot drift apart. Paragraphs → lines → segments: `bold` is
// the one emphasised phrase, `ltr` isolates the phone number, which otherwise risks being
// reordered by the bidi algorithm inside right-to-left text in some clients.
type Segment = string | { bold: string } | { ltr: string };
type Line = Segment[];
type Paragraph = Line[];

const EMAIL_BODY: Paragraph[] = [
  [
    ['מצ"ב ', { bold: "דוח אבחון קריאה" }, ' ממכון קמ"ש,'],
    ["המזכירה תפנה אליכם בהקדם לשיבוץ מורה מתאימה בעבורכם"],
  ],
  [["לכל פנייה, שאלה או לייעוץ נוסף, אתם מוזמנים לפנות למכון: ", { ltr: "02-5001050" }]],
  [["בברכת הצלחה רבה"], ['מ\' מרגליות, מנהלת קלינית מכון קמ"ש']],
];

const CRLF = "\r\n";

function getGmailClient() {
  const { GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN } = config;
  if (!GMAIL_OAUTH_CLIENT_ID || !GMAIL_OAUTH_CLIENT_SECRET || !GMAIL_OAUTH_REFRESH_TOKEN) {
    throw new HttpError(500, "Gmail OAuth credentials are not configured");
  }
  const oauth2Client = new google.auth.OAuth2(GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GMAIL_OAUTH_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

/** RFC 2047 encoded-word, for header values (subject, legacy filename parameters). */
function encodeWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

/** RFC 2231 extended parameter value: UTF-8, percent-encoding everything outside attr-char
 * (encodeURIComponent alone leaves ' ( ) * ! unescaped, and those are not attr-chars). */
function encodeRfc2231(value: string): string {
  return `UTF-8''${encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;
}

/** Base64 body wrapped at 76 characters per line, as MIME requires. */
function base64Body(content: Buffer): string {
  return (content.toString("base64").match(/.{1,76}/g) ?? []).join(CRLF);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function segmentText(segment: Segment): string {
  if (typeof segment === "string") return segment;
  return "bold" in segment ? segment.bold : segment.ltr;
}

function segmentHtml(segment: Segment): string {
  if (typeof segment === "string") return escapeHtml(segment);
  if ("bold" in segment) return `<b>${escapeHtml(segment.bold)}</b>`;
  return `<span dir="ltr" style="direction:ltr;unicode-bidi:embed;">${escapeHtml(segment.ltr)}</span>`;
}

export function renderEmailText(): string {
  return EMAIL_BODY.map((paragraph) => paragraph.map((line) => line.map(segmentText).join("")).join("\n")).join(
    "\n\n",
  );
}

// Direction is set on every element, inline: Gmail drops <head> styles and some clients ignore
// `dir` on <html>/<body>, so each level carries its own `dir` and `direction`/`text-align`.
export function renderEmailHtml(): string {
  const paragraphs = EMAIL_BODY.map(
    (paragraph) =>
      `<p dir="rtl" style="direction:rtl;text-align:right;margin:0 0 16px 0;">${paragraph
        .map((line) => line.map(segmentHtml).join(""))
        .join("<br>")}</p>`,
  ).join("\n");
  return [
    "<!DOCTYPE html>",
    '<html dir="rtl" lang="he">',
    '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body dir="rtl" style="direction:rtl;text-align:right;margin:0;padding:0;">',
    '<div dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222222;">',
    paragraphs,
    "</div>",
    "</body>",
    "</html>",
  ].join(CRLF);
}

/**
 * The full RFC 5322 message, before Gmail's base64url wrapping:
 * multipart/mixed[ multipart/alternative[ text/plain, text/html ], attachment ].
 * Text parts are base64 rather than 7bit — 7bit is wrong for UTF-8 Hebrew. The attachment
 * filename is Hebrew ("אבחון <name>.pdf"), so it goes out as RFC 2231 `filename*` with an
 * RFC 2047 `filename`/`name` fallback for clients that only read the older form; encoding
 * it also means a CR/LF or quote in the client-supplied name cannot break out of the header.
 */
export function buildMimeMessage(to: string, attachment: EmailAttachment): string {
  const id = randomUUID().replace(/-/g, "");
  const mixed = `kamash_mixed_${id}`;
  const alternative = `kamash_alt_${id}`;
  const text = renderEmailText().replace(/\n/g, CRLF);
  const legacyName = encodeWord(attachment.filename);
  const extendedName = encodeRfc2231(attachment.filename);

  const lines = [
    `To: ${to}`,
    `Subject: ${encodeWord(EMAIL_SUBJECT)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(Buffer.from(text, "utf-8")),
    "",
    `--${alternative}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(Buffer.from(renderEmailHtml(), "utf-8")),
    "",
    `--${alternative}--`,
    "",
    `--${mixed}`,
    `Content-Type: ${attachment.mimeType}; name="${legacyName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${legacyName}"; filename*=${extendedName}`,
    "",
    base64Body(attachment.content),
    "",
    `--${mixed}--`,
  ];
  return lines.join(CRLF);
}

function buildRawMessage(to: string, attachment: EmailAttachment): string {
  const raw = Buffer.from(buildMimeMessage(to, attachment), "utf-8").toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendDiagnosisEmail({ to, attachment }: SendDiagnosisEmailParams): Promise<void> {
  const gmail = getGmailClient();
  const raw = buildRawMessage(to, attachment);
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}
