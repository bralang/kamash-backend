import { chatComplete } from "./openaiService.js";
import { GROUP_HEADING_MARKER, stripGroupHeadingMarker } from "../lib/headingMarker.js";
import type { PatientIntake } from "../types/diagnosis.js";

export interface SectionToHtmlParams {
  sectionTitle: string;
  formattingInstructions: string;
  sectionText: string;
}

const SECTION_HTML_PROMPT = (params: SectionToHtmlParams) => `SYSTEM
אתה אחראי לעיצוב מקטעים של מסמך אבחון קריאה.
תפקידך לקבל מקטע טקסט ערוך והוראות עיצוב ייעודיות, ולהמיר את המקטע ל-HTML נקי, תקני ואחיד.

המטרה:
כל קריאה מטפלת במקטע אחד בלבד.
בהמשך כל מקטעי ה-HTML יחוברו יחד למסמך מלא, ולכן יש להחזיר רק את ה-HTML של המקטע הנוכחי.

INPUT
שם המקטע:
${params.sectionTitle}

הוראות עיצוב למקטע:
${params.formattingInstructions}

טקסט ערוך:
${params.sectionText}

TASK
המר את הטקסט הערוך ל-HTML בהתאם להוראות העיצוב של המקטע.

כללים מחייבים:
1. החזר HTML בלבד.
2. אל תוסיף הסברים, הערות או Markdown.
3. אל תעטוף את הפלט ב-\`\`\`html.
4. אל תיצור מסמך HTML מלא.
5. אין להחזיר תגיות html, head או body.
6. עטוף כל מקטע בתגית section.
7. הוסף ל-section class קבוע בשם diagnosis-section.
8. הוסף ל-section attribute בשם data-section עם שם המקטע כפי שהתקבל.
9. כותרת המקטע תהיה h2.
10. רמות הכותרות נקבעות לפי הסימון בטקסט: שורת כותרת שמתחילה ב-${GROUP_HEADING_MARKER} היא כותרת ראשית ותהפוך ל-h3, וכותרת שאינה מתחילה ב-${GROUP_HEADING_MARKER} ומופיעה תחת כותרת ראשית כזו תהפוך ל-h4. אם בטקסט אין אף שורה שמתחילה ב-${GROUP_HEADING_MARKER}, כל תתי הכותרות יהיו h3, אלא אם הוראות העיצוב דורשות רמה נוספת או שיש בטקסט בבירור רמת היררכיה שלישית. אל תשתמש ב-h5 או ב-h6.
10א. הקידומת ${GROUP_HEADING_MARKER} היא סימון פנימי בלבד. הסר אותה מטקסט הכותרת ואל תכתוב אותה בפלט בשום מקום.
11. פסקאות יהיו p.
12. רשימות יהיו ul/li.
13. רשימות ממוספרות יהיו ol/li רק אם יש משמעות לסדר השלבים.
14. שמור על כל המידע המקורי.
15. אל תשנה ניסוח, אל תקצר ואל תוסיף תוכן.
16. מותר לשנות רק את המבנה הוויזואלי והתגיות.
17. אם יש ירידות שורה בטקסט, המר אותן למבנה HTML תקין ולא לבלוק טקסט אחד.
18. אם הטקסט כולל נקודות ברורות, המר אותן לרשימת ul.
19. אם הטקסט כולל שלבים ממוספרים, המר אותם ל-ol.
20. אם יש שדות כמו שם, גיל, כיתה, תאריך, הצג אותם במבנה שורות קבוע.
21. אל תשתמש בעיצוב inline style.
22. אל תשתמש ב-JavaScript.
23. אל תשתמש בטבלאות, אלא אם הוראות העיצוב דורשות זאת במפורש.
24. אם הוראות העיצוב דורשות טבלה, המר את המידע הרלוונטי למבנה table תקני.
25. טבלה תיבנה עם התגיות table, thead, tbody, tr, th, td.
26. שורת הכותרות של הטבלה תהיה בתוך thead ותכלול th.
27. שורות התוכן יהיו בתוך tbody ותכלולנה td.
28. הוסף לטבלה class בשם diagnosis-table.
29. אל תוסיף עיצוב inline לטבלה.
30. יש להניח שעיצוב הגריד, הגבולות והרקע האפור לכותרת יוגדרו ב-CSS חיצוני לפי class בשם diagnosis-table.
31. אם המידע אינו מתאים בבירור לטבלה, אל תיצור טבלה גם אם יש כמה שורות.
32. שמור על HTML סמנטי ונקי.
33. הפלט חייב להיות תקין גם כאשר יחובר למקטעים נוספים.

מבנה פלט בסיסי:
<section class="diagnosis-section" data-section="${params.sectionTitle}">
  <h2>${params.sectionTitle}</h2>
  ...
</section>

OUTPUT
HTML בלבד.`;

/** Normalises heading text for comparison: tags and entities out, Hebrew geresh and
 * gershayim folded to ASCII quotes, whitespace collapsed, trailing colon or dash dropped. */
function normaliseHeading(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\u05F4\u201C\u201D]/g, '"')
    .replace(/[\u05F3\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:\-\u2013\u2014]+$/, "")
    .trim();
}

function isRedundantSubheading(heading: string, sectionTitle: string): boolean {
  if (heading === "" || heading === sectionTitle) return true;
  // Whole-word containment only, checked without a regex so heading text never has to be
  // escaped. Both strings come from normaliseHeading, so every run of whitespace is already
  // a single space and edge-anchoring is exact: "המלצות" inside "המלצות לטיפולים חיצוניים"
  // is redundant, but "המלצות להתערבות" inside that same title is a real subheading.
  const at = sectionTitle.indexOf(heading);
  if (at === -1) return false;
  const before = at === 0 ? " " : sectionTitle[at - 1];
  const end = at + heading.length;
  const after = end === sectionTitle.length ? " " : sectionTitle[end];
  return before === " " && after === " ";
}

/** Departure from n8n: the section-HTML model intermittently emits a sub-heading that only
 * restates the section's own h2 ("המלצות" under "המלצות לטיפולים חיצוניים"), which the clinic
 * deleted by hand in every diagnosis we compared. Stripping it here rather than in the prompt
 * makes it certain instead of merely likely. Deliberately conservative — it removes a heading
 * only when the h2 already contains it word-for-word, so a paraphrase such as
 * "סיכום קשיים שנצפו באבחון" under "הקשיים שנצפו" is left alone for a human to judge. */
export function stripRedundantSubheadings(html: string, sectionTitle: string): string {
  const title = normaliseHeading(sectionTitle);
  if (title === "") return html;
  return html.replace(/[ \t]*<(h3|h4)\b[^>]*>([\s\S]*?)<\/\1>[ \t]*\r?\n?/gi, (match, _tag, inner: string) =>
    isRedundantSubheading(normaliseHeading(inner), title) ? "" : match,
  );
}

/** Last-resort guard for the group-heading marker: rule 10א tells the model to consume the
 * prefix, but a prompt is a request, not a guarantee, and a leaked "##" would surface inside a
 * heading in the clinic's document. Strips it from h2/h3/h4 text wherever it survived. */
export function stripGroupHeadingMarkers(html: string): string {
  return html.replace(
    /(<(h2|h3|h4)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (_match, open: string, _tag, inner: string, close: string) =>
      `${open}${stripGroupHeadingMarker(inner)}${close}`,
  );
}

export async function sectionToHtml(params: SectionToHtmlParams): Promise<string> {
  const html = await chatComplete({ user: SECTION_HTML_PROMPT(params) });
  return stripRedundantSubheadings(stripGroupHeadingMarkers(html.trim()), params.sectionTitle);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The intake form posts `date` as an ISO `YYYY-MM-DD` string (what an
 * `<input type="date">` yields), but the clinic writes dates as DD/MM/YYYY and edits
 * every rendered document by hand to match. Convert at render time only — the value
 * stored in the "אבחונים" sheet stays ISO, since that column is read back by n8n and
 * by the frontend. Anything that is not exactly ISO passes through untouched rather
 * than being reformatted on a guess. */
export function formatDiagnosisDate(date: string): string {
  const match = ISO_DATE.exec(date.trim());
  if (!match) return date;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

const PERSONAL_DETAILS_TITLE = "פרטים אישיים";

/** Deterministic (LLM-free) personal-details section — built straight from the intake
 * form fields so no transcript content can leak in. Mirrors the structural rules the
 * section-HTML prompt mandates (section wrapper, h2 title, one p row per field). */
export function buildPersonalDetailsHtml(patient: PatientIntake): string {
  const fields: [label: string, value: string][] = [
    ["שם", patient.name],
    ["גיל", patient.age],
    ["מקום לימודים", patient.school],
    ["כיתה", patient.grade],
    ["עיר מגורים", patient.city],
    ["תאריך אבחון", formatDiagnosisDate(patient.date)],
  ];
  const rows = fields
    .filter(([, value]) => value.trim() !== "")
    .map(([label, value]) => `  <p><strong>${label}:</strong> ${escapeHtml(value.trim())}</p>`)
    .join("\n");
  return `<section class="diagnosis-section" data-section="${PERSONAL_DETAILS_TITLE}">
  <h2>${PERSONAL_DETAILS_TITLE}</h2>
${rows}
</section>`;
}

/** Deterministic (LLM-free) final assembly — matches the live-wired "Code in JavaScript5"
 * node from n8n's "המרת אבחון לhtml להצגה" workflow exactly, CSS included, with one
 * intentional departure: an `h4` rule n8n never had, so a section can carry a third
 * heading level when its הוראות עיצוב call for one (see rule 10 of SECTION_HTML_PROMPT).
 * It continues the 30→22→18 scale at 16px and the halving margin rhythm of h2/h3; bold
 * plus that rhythm — not size — is what separates it from body text. */
export function assembleDocument(sectionHtmls: string[]): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>סיכום אבחון קריאה</title>
  <style>
    body {
      direction: rtl;
      text-align: right;
      font-family: Arial, sans-serif;
      line-height: 1.5;
      color: #222;
      background: #ffffff;
      margin: 0;
    }

    .diagnosis-document {
      max-width: 1000px;
      margin: 0 auto;
      padding: 0;
    }

    h1 {
      text-align: center;
      margin-bottom: 35px;
      font-size: 30px;
    }

    .diagnosis-section {
      margin-bottom: 32px;
    }

    h2 {
      font-size: 22px;
      margin: 28px 0 14px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 6px;
    }

    h3 {
      font-size: 18px;
      margin: 18px 0 8px;
    }

    h4 {
      font-size: 16px;
      margin: 14px 0 6px;
    }

    p {
      margin: 0 0 10px;
    }

    ul {
      margin: 8px 0 16px;
      padding-right: 6px;
    }

    li {
      margin-bottom: 7px;
    }

    /* ===== טבלאות ===== */

    .diagnosis-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0 24px;
      font-size: 15px;
    }

    .diagnosis-table th,
    .diagnosis-table td {
      border: 1px solid #d6d6d6;
      padding: 10px 12px;
      text-align: right;
      vertical-align: top;
    }

    .diagnosis-table thead th {
      background-color: #f3f3f3;
      font-weight: bold;
    }

    .diagnosis-table tbody tr:nth-child(even) {
      background-color: #fafafa;
    }

    .diagnosis-table tbody tr:hover {
      background-color: #f7f7f7;
    }
  </style>
</head>
<body>
  <main class="diagnosis-document">
    <h1>סיכום אבחון קריאה</h1>

    ${sectionHtmls.join("\n\n")}
  </main>
</body>
</html>`;
}
