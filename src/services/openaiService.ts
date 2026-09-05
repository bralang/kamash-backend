import OpenAI, { toFile } from "openai";
import { config } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";
import type { SegmentedDiagnosis } from "../types/diagnosis.js";

const CHAT_MODEL = "gpt-4.1";
const WHISPER_MODEL = "whisper-1";

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!config.OPENAI_API_KEY) {
    throw new HttpError(500, "OPENAI_API_KEY is not configured");
  }
  if (!client) {
    client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return client;
}

export async function transcribe(buffer: Buffer, filename: string): Promise<string> {
  const openai = getClient();
  const file = await toFile(buffer, filename);
  const result = await openai.audio.transcriptions.create({
    file,
    model: WHISPER_MODEL,
    language: "he",
    temperature: 0,
  });
  return result.text;
}

export async function chatComplete(params: { system?: string; user: string; model?: string }): Promise<string> {
  const openai = getClient();
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  messages.push({ role: "user", content: params.user });

  const completion = await openai.chat.completions.create({
    model: params.model ?? CHAT_MODEL,
    messages,
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI chat completion returned no content");
  }
  return text;
}

const SEGMENTED_DIAGNOSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    referral_reason: { type: "string" },
    general_impression: { type: "string" },
    diagnosis_findings: { type: "string" },
    difficulties: { type: "string" },
    work_plan: { type: "string" },
    summary_and_recommendations: { type: "string" },
    home_practice: { type: "string" },
    goals: { type: "string" },
    external_treatments: { type: "string" },
  },
  required: [
    "referral_reason",
    "general_impression",
    "diagnosis_findings",
    "difficulties",
    "work_plan",
    "summary_and_recommendations",
    "home_practice",
    "goals",
    "external_treatments",
  ],
};

const SEGMENTATION_PROMPT = `קיבלת טקסט של אבחון קריאה.

עליך לחלץ את המידע למבנה JSON לפי הסכמה הבאה.

כללים:
1. אל תנסח מחדש.
2. שמור את הטקסט כפי שהוא מופיע.
3. אם מידע חסר - השאר שדה ריק.
4. אל תוסיף מידע שלא מופיע בטקסט.
5. הפלט חייב להיות JSON תקין בלבד.
6. כל פריט מידע מהמקור צריך להופיע בחלק אחד בלבד, אין להכפיל את המידע מהמקור למספר סעיפים בפילוח
7. בממצאי האבחון תכלול את המדדים הכמותיים של האבחון, שנבחנו במספרים בשטף ובקצב. יחד עם כל מדד כזה תכלול גם את הפירוט האיכותני הצמוד לו בטקסט, כגון אילו אותיות או תנועות היו שגויות באותה בדיקה. תיאורי קושי כלליים שאינם צמודים למדד כמותי אינם שייכים לסעיף זה.
8. כאשר בטקסט מופיע תיקון של מידע שנאמר קודם, למשל המילה תיקון או ניסוח של חזרה בה כגון טעיתי או לא נכון, שבץ את התיקון באותו סעיף שבו נמצא המידע המקורי, גם אם הוא נאמר במרחק ממנו בטקסט. אל תכריע בין הגרסאות ואל תמחק אף אחת מהן בשלב זה, רק דאג ששתיהן יופיעו יחד באותו סעיף.
9. הגבול בין referral_reason ל-general_impression: ב-referral_reason שבץ את הרקע שקדם לאבחון, כלומר מי הפנה ומדוע, מה דיווחו ההורים או המורה על התפקוד בבית ובכיתה, וטיפולים קודמים. ב-general_impression שבץ אך ורק את מה שנצפה במהלך האבחון עצמו. דיווח של הורה או של מורה אינו שייך ל-general_impression, גם כאשר הוא נאמר בטקסט לצד תיאורי התצפית.
10. הגבול בין home_practice ל-goals: ב-goals שבץ את יעדי הביצוע הניתנים למדידה, כגון שטף בזמן נתון או דיוק באחוזים. ב-home_practice שבץ את מה שההורים מתבקשים לעשות בפועל. אל תשבץ יעד מספרי בשני הסעיפים; זהו המקרה שכלל 6 נשבר בו בפועל.`;

export async function segmentToJson(cleanedTranscript: string): Promise<SegmentedDiagnosis> {
  const openai = getClient();
  const prompt = `${SEGMENTATION_PROMPT}

הטקסט:
${cleanedTranscript}`;

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "segmented_diagnosis", strict: true, schema: SEGMENTED_DIAGNOSIS_SCHEMA },
    },
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI segmentation returned no content");
  }
  return JSON.parse(text) as SegmentedDiagnosis;
}
