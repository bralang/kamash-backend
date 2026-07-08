import { diagnosesRepo, versionsRepo } from "../sheetsService.js";
import { createDoc, uploadText } from "../driveService.js";
import { chatComplete, segmentToJson } from "../openaiService.js";
import { rewriteSection } from "../anthropicService.js";
import { getGeneralRules, getSectionInstructions } from "../configRepo.js";
import { sectionToHtml, assembleDocument } from "../htmlConversionService.js";
import { markJobFailed } from "./errorHandler.js";
import { DIAGNOSES_COLUMNS, DiagnosisStatus } from "../../config/sheets.js";
import type { PatientIntake, SegmentedDiagnosis } from "../../types/diagnosis.js";

export interface Step1PipelineInput {
  jobId: string;
  folderId: string;
  rawTranscript: string;
  patient: PatientIntake;
}

// "ניקוי תמלול בלבד" — spelling/punctuation only, explicitly forbidden from rewriting.
const CLEANUP_SYSTEM_PROMPT = `המטרה: ניקוי תמלול בלבד.

מותר לך לבצע רק:
- תיקון שגיאות כתיב
- תיקון מילים שזוהו לא נכון
- הוספת פיסוק
- חיבור מילים שנחתכו

אסור לבצע:
- שכתוב סגנוני
- קיצור
- שינוי מבנה משפטים
- הוספת הסברים

יש לשמור על ניסוח קרוב ככל האפשר לטקסט המקורי.

הטקסט הוא מתוך אבחון קריאה לילדים במכון קמ"ש.
המונחים עשויים לכלול מושגים כמו: מודעות פונולוגית, שליפה, קידוד שמיעתי, שטף קריאה, תנועות, צירופים וכדומה.`;

/** Flattens the segmented diagnosis into a uniform section-key → text map, matching
 * n8n's own `Object.entries(inputData)` iteration — personal_details is included as a
 * first-class section (serialized to JSON text) exactly like the other 9 fields, since
 * the source workflow rewrites and formats it through the very same per-section pipeline. */
function toSectionTextMap(segmented: SegmentedDiagnosis): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(segmented)) {
    map[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return map;
}

function isMeaningful(text: string | undefined): text is string {
  return Boolean(text && text.trim() && text.trim() !== "{}");
}

export async function runStep1Pipeline(input: Step1PipelineInput): Promise<void> {
  const { jobId, folderId, rawTranscript, patient } = input;

  try {
    // 1. Save raw transcript as a Drive Doc.
    await createDoc(folderId, `תמלול ${patient.name}`, rawTranscript);

    // 2. Clean transcript (spelling/punctuation only).
    const cleanedTranscript = await chatComplete({
      system: CLEANUP_SYSTEM_PROMPT,
      user: `זה הטקסט המתומלל:\n${rawTranscript}`,
    });
    await createDoc(folderId, `ניקוי תמלול ${patient.name}`, cleanedTranscript);

    // 3. Segment into the fixed JSON schema.
    const segmented = await segmentToJson(cleanedTranscript, patient);
    await uploadText(folderId, `חלוקה למקטעים-${jobId}.json`, JSON.stringify(segmented, null, 2), "application/json");
    await diagnosesRepo.updateByJobId(jobId, { [DIAGNOSES_COLUMNS.STATUS]: DiagnosisStatus.PROCESSING2 });

    // 4. Rewrite each non-empty section via Claude (formerly sub-workflow "עריכה ראשונית").
    const sectionTexts = toSectionTextMap(segmented);
    const generalRules = await getGeneralRules();
    const rewritten: Record<string, string> = {};
    for (const [key, text] of Object.entries(sectionTexts)) {
      if (!isMeaningful(text)) continue;
      const instructions = await getSectionInstructions(key);
      rewritten[key] = await rewriteSection({
        sectionText: text,
        editingInstructions: instructions?.editingInstructions ?? "",
        generalRules,
        patient: { name: patient.name, age: patient.age, school: patient.school, grade: patient.grade, city: patient.city },
      });
    }
    const rewrittenFile = await uploadText(
      folderId,
      `עריכה לשונית v0-${jobId}.json`,
      JSON.stringify(rewritten, null, 2),
      "application/json",
    );
    await versionsRepo.appendVersion(jobId, 0, rewrittenFile.fileId);
    await diagnosesRepo.updateByJobId(jobId, { [DIAGNOSES_COLUMNS.LATEST_VERSION]: rewrittenFile.link });

    // 5. Convert each rewritten section to HTML (formerly sub-workflow "המרת אבחון לhtml להצגה"),
    //    then assemble deterministically (no LLM) — matches the live-wired n8n graph exactly.
    const sectionHtmls: string[] = [];
    for (const [key, text] of Object.entries(rewritten)) {
      if (!isMeaningful(text)) continue;
      const instructions = await getSectionInstructions(key);
      const html = await sectionToHtml({
        sectionTitle: instructions?.sectionTitleHe ?? key,
        formattingInstructions: instructions?.formattingInstructions ?? "",
        sectionText: text,
      });
      sectionHtmls.push(html);
    }
    const fullHtml = assembleDocument(sectionHtmls);
    const htmlFile = await uploadText(folderId, `html-${jobId}.html`, fullHtml, "text/html");
    await diagnosesRepo.updateByJobId(jobId, {
      [DIAGNOSES_COLUMNS.LATEST_VERSION_HTML]: htmlFile.link,
      [DIAGNOSES_COLUMNS.STATUS]: DiagnosisStatus.DONE,
    });
  } catch (err) {
    await markJobFailed(jobId, err, "step1Pipeline");
  }
}
