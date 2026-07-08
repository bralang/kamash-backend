import OpenAI, { toFile } from "openai";
import { config } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";
import type { PatientIntake, SegmentedDiagnosis } from "../types/diagnosis.js";

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
    personal_details: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        age: { type: "string" },
        grade: { type: "string" },
        school: { type: "string" },
        city: { type: "string" },
        diagnosis_date: { type: "string" },
      },
      required: ["name", "age", "grade", "school", "city", "diagnosis_date"],
    },
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
    "personal_details",
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
3. אם מידע חסר – השאר שדה ריק.
4. אל תוסיף מידע שלא מופיע בטקסט.
5. הפלט חייב להיות JSON תקין בלבד.
6. כל פריט מידע מהמקור צריך להופיע בחלק אחד בלבד, אין להכפיל את המידע מהמקור למספר סעיפים בפילוח
7. בממצאי האבחון תכלול רק מדדים כמותיים של האבחון, שנבחנו במספרים בשטף ובקצב.`;

export async function segmentToJson(cleanedTranscript: string, personalDetails: PatientIntake): Promise<SegmentedDiagnosis> {
  const openai = getClient();
  const prompt = `${SEGMENTATION_PROMPT}

הטקסט:
${cleanedTranscript}

את הפרטים האישיים תקח מהקלט הזה:
${JSON.stringify(personalDetails)}`;

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
