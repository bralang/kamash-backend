import { describe, it, expect } from "vitest";
import { buildMimeMessage, EMAIL_SUBJECT } from "../src/services/emailService.js";

// A deliberately small MIME reader — just enough to take apart what buildMimeMessage emits,
// so the assertions are about what a mail client would decode, not about the raw bytes.
interface Part {
  headers: Record<string, string>;
  body: string;
}

function parsePart(raw: string): Part {
  const split = raw.indexOf("\r\n\r\n");
  const headerBlock = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 4);
  const headers: Record<string, string> = {};
  for (const line of headerBlock.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { headers, body };
}

function boundaryOf(contentType: string): string {
  const match = /boundary="([^"]+)"/.exec(contentType);
  if (!match?.[1]) throw new Error(`no boundary in ${contentType}`);
  return match[1];
}

function children(part: Part): Part[] {
  const boundary = boundaryOf(part.headers["content-type"] ?? "");
  const [, ...rest] = part.body.split(`--${boundary}`);
  return rest
    .filter((chunk) => !chunk.startsWith("--"))
    .map((chunk) => parsePart(chunk.replace(/^\r\n/, "").replace(/\r\n$/, "")));
}

function decodeBase64Body(part: Part): Buffer {
  expect(part.headers["content-transfer-encoding"]).toBe("base64");
  for (const line of part.body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
  return Buffer.from(part.body.replace(/\r\n/g, ""), "base64");
}

function decodeEncodedWord(value: string): string {
  const match = /^=\?UTF-8\?B\?([^?]+)\?=$/.exec(value);
  if (!match?.[1]) throw new Error(`not an RFC 2047 encoded-word: ${value}`);
  return Buffer.from(match[1], "base64").toString("utf-8");
}

const EXPECTED_BODY = [
  'מצ"ב דוח אבחון קריאה ממכון קמ"ש,',
  "המזכירה תפנה אליכם בהקדם לשיבוץ מורה מתאימה בעבורכם",
  "",
  "לכל פנייה, שאלה או לייעוץ נוסף, אתם מוזמנים לפנות למכון: 02-5001050",
  "",
  "בברכת הצלחה רבה",
  'מ\' מרגליות, מנהלת קלינית מכון קמ"ש',
].join("\n");

const filename = "אבחון ילד א'.pdf";
const pdf = Buffer.from("%PDF-1.4 fake pdf content");

describe("buildMimeMessage", () => {
  const message = parsePart(buildMimeMessage("parent@example.com", { filename, mimeType: "application/pdf", content: pdf }));
  const [alternative, attachment] = children(message);
  const [plain, html] = children(alternative!);

  it("addresses the recipient with the clinic's subject, RFC 2047-encoded", () => {
    expect(message.headers["to"]).toBe("parent@example.com");
    expect(decodeEncodedWord(message.headers["subject"] ?? "")).toBe(EMAIL_SUBJECT);
    expect(EMAIL_SUBJECT).toBe('סיכום אבחון קמ"ש');
    expect(message.headers["content-type"]).toMatch(/^multipart\/mixed;/);
    expect(alternative?.headers["content-type"]).toMatch(/^multipart\/alternative;/);
  });

  it("carries the exact wording as a UTF-8 plain-text fallback", () => {
    expect(plain?.headers["content-type"]).toBe("text/plain; charset=UTF-8");
    const text = decodeBase64Body(plain!).toString("utf-8").replace(/\r\n/g, "\n");
    expect(text).toBe(EXPECTED_BODY);
  });

  it("renders the HTML part right-to-left, with the bold phrase and an isolated phone number", () => {
    expect(html?.headers["content-type"]).toBe("text/html; charset=UTF-8");
    const markup = decodeBase64Body(html!).toString("utf-8");
    expect(markup).toContain('<html dir="rtl" lang="he">');
    expect(markup).toMatch(/<div dir="rtl" style="direction:rtl;text-align:right;/);
    expect(markup).toContain("<b>דוח אבחון קריאה</b>");
    expect(markup).toMatch(/<span dir="ltr"[^>]*>02-5001050<\/span>/);
    // Every paragraph carries its own direction, since Gmail strips head styles.
    const paragraphs = markup.match(/<p [^>]*>/g) ?? [];
    expect(paragraphs).toHaveLength(3);
    for (const p of paragraphs) expect(p).toContain('dir="rtl"');
    // Same words as the plain part, once the markup is gone.
    const visible = markup
      .slice(markup.indexOf("<p "))
      .replace(/<br>/g, "\n")
      .replace(/<\/p>\r?\n?/g, "\n\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    expect(visible).toBe(EXPECTED_BODY);
  });

  it("encodes the Hebrew attachment filename so it round-trips", () => {
    const disposition = attachment?.headers["content-disposition"] ?? "";
    const extended = /filename\*=UTF-8''([^;\s]+)/.exec(disposition)?.[1];
    expect(extended).toBeDefined();
    expect(extended).not.toMatch(/['()*!]/);
    expect(decodeURIComponent(extended!)).toBe(filename);

    const legacy = /filename="([^"]+)"/.exec(disposition)?.[1];
    expect(decodeEncodedWord(legacy ?? "")).toBe(filename);
    const name = /name="([^"]+)"/.exec(attachment?.headers["content-type"] ?? "")?.[1];
    expect(decodeEncodedWord(name ?? "")).toBe(filename);

    expect(attachment?.headers["content-type"]).toMatch(/^application\/pdf;/);
    expect(decodeBase64Body(attachment!).equals(pdf)).toBe(true);
  });

  it("keeps every header line ASCII", () => {
    const headerLines = [message, alternative!, plain!, html!, attachment!].flatMap((p) => Object.values(p.headers));
    for (const line of headerLines) expect(line).toMatch(/^[\x20-\x7e]*$/);
  });
});
