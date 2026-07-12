import { chatComplete } from "./openaiService.js";
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
10. תתי כותרות יהיו h3.
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

export async function sectionToHtml(params: SectionToHtmlParams): Promise<string> {
  const html = await chatComplete({ user: SECTION_HTML_PROMPT(params) });
  return html.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    ["תאריך אבחון", patient.date],
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
 * node from n8n's "המרת אבחון לhtml להצגה" workflow exactly, CSS included. */
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
