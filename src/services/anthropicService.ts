import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";

// Verify this is still a valid API model id before relying on it in production — carried
// over from the n8n export as-is. See migration plan "Open items".
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new HttpError(500, "ANTHROPIC_API_KEY is not configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface PatientContext {
  name: string;
  age: string;
  school: string;
  grade: string;
  city: string;
}

export interface RewriteSectionParams {
  sectionText: string;
  editingInstructions: string;
  generalRules: string;
  patient: PatientContext;
  /** Closed sub-heading list (verbatim config-sheet cell). Empty/omitted → prompt unchanged. */
  allowedSubheadings?: string;
}

// Appended to the system prompt only when the section has a closed sub-heading list configured.
const ALLOWED_SUBHEADINGS_TEMPLATE = (allowedSubheadings: string) => `

כותרות משנה — רשימה סגורה וניסוחים סטנדרטיים:
ברשימה הבאה, כל שורה ראשית היא כותרת משנה מותרת, והפריטים תחת כל כותרת הם ניסוחים סטנדרטיים לתכנים ששייכים לאותה כותרת.

${allowedSubheadings}

כללים מחייבים:
1. כותרות המשנה חייבות להילקח אך ורק מהרשימה הזו, בניסוח המדויק שלהן, ללא כל שינוי.
2. אסור להמציא כותרות משנה חדשות ואסור לשנות את נוסח הכותרות.
3. השתמש רק בכותרות הרלוונטיות לתוכן שקיים בפועל בטקסט — בדרך כלל רק חלק מהכותרות יופיעו.
4. כותרת שאין לה תוכן מתאים בטקסט — השמט אותה לחלוטין, אל תכתוב אותה ריקה.
5. שבץ כל פריט מידע מהטקסט תחת הכותרת המתאימה לו.
6. כאשר תוכן מהטקסט תואם לאחד הניסוחים הסטנדרטיים שתחת הכותרת — השתמש בניסוח הסטנדרטי המדויק מהרשימה.
7. תוכן מהטקסט שאין לו ניסוח סטנדרטי מתאים ברשימה — נסח אותו מקצועית לפי שאר הכללים, תחת הכותרת המתאימה; אין להשמיט מידע.`;

const SYSTEM_PROMPT_TEMPLATE = (editingInstructions: string, generalRules: string, allowedSubheadings: string) => `SYSTEM
אתה עורך לשוני מקצועי לאבחונים של מכון קמ"ש.
המשימה שלך היא לערוך טקסט תמלול לאבחון קריאה, בעברית מקצועית וברורה.
שמור על סגנון מקצועי ותמציתי.
הקפד על:
ניסוח מקצועי בשפה גבוהה אך ברורה
שימוש בלשון עבר
ללא סלנג או ביטויים מדוברים
ללא הוספת מידע שלא הופיע בתמלול
ניסוח תמציתי - ללא חזרות
מעבר ממשפטים דיבוריים למשפטים כתובים תקניים בלשון גבוהה

RULES:
הוראות עריכה:
${editingInstructions}

${generalRules}${allowedSubheadings ? ALLOWED_SUBHEADINGS_TEMPLATE(allowedSubheadings) : ""}`;

const TASK_PROMPT_TEMPLATE = (sectionText: string, patient: PatientContext) => `INPUT
תמלול גולמי:
${sectionText}

TASK

קיבלת לערוך אבחון של ${patient.name}
גיל הילד: ${patient.age}
לומד ב: ${patient.school}
בכיתה: ${patient.grade}
גר ב: ${patient.city}

ערוך את הטקסט, התאם את סגנון הניסוח לדוגמאות שקיבלת, תצמד לנתונים מהתמלול, אין להוסיף פרטים שלא נאמרו בתמלול. הדיוק בעובדות המקור הכרחי וחשוב. התמקד רק בניסוח טוב בעברית תקנית ומקצועית, יחד עם זאת זורמת.
תקן שגיאות כתיב.
אל תשמיט מידע!
באבחון בודקים מיומנויות של קריאה והאבחון דורש מהילדים הנבדקים מאמץ קוגנטיבי רב לאורך האבחון כולו.
תתאים את התאורים של הילד לפי הגיל ולפי המאפיינים של מקום המגורים ושיוך מגזרי (ליטאי, חסידי, ספרדי) ויש להתיחס אם צוין שהילד חינוך מיוחד ולהתאים את התאורים לרמה הקוגנטיבית

OUTPUT
טקסט מוכן לשילוב באבחון.`;

export async function rewriteSection(params: RewriteSectionParams): Promise<string> {
  const anthropic = getClient();
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT_TEMPLATE(params.editingInstructions, params.generalRules, params.allowedSubheadings?.trim() ?? ""),
    messages: [{ role: "user", content: TASK_PROMPT_TEMPLATE(params.sectionText, params.patient) }],
  });
  const block = message.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Anthropic rewrite returned no text content");
  }
  return block.text;
}
