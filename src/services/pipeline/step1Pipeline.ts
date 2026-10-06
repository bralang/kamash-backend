import { diagnosesRepo, versionsRepo } from "../sheetsService.js";
import { createDoc, uploadText } from "../driveService.js";
import { chatComplete, segmentToJson, transcribe } from "../openaiService.js";
import { ensureTranscribable } from "../audioService.js";
import { rewriteSection } from "../anthropicService.js";
import { getGeneralRule, getGeneralRules, getSectionInstructions, FIXED_TERMS_RULE_TYPE } from "../configRepo.js";
import { sectionToHtml, assembleDocument, buildPersonalDetailsHtml } from "../htmlConversionService.js";
import { markJobFailed } from "./errorHandler.js";
import { DIAGNOSES_COLUMNS, DiagnosisStatus } from "../../config/sheets.js";
import type { PatientIntake } from "../../types/diagnosis.js";

export interface Step1PipelineInput {
  jobId: string;
  folderId: string;
  /** The recording exactly as uploaded (it is already in Drive as-is). Transcribed here,
   * not in the route, so step1 can respond before Whisper finishes. */
  recording: { buffer: Buffer; filename: string };
  patient: PatientIntake;
}

// "ניקוי תמלול בלבד" — spelling/punctuation only, explicitly forbidden from rewriting.
// The hardcoded dictionary below covers Whisper mishearings we diffed out of real output; the
// clinic's own term list arrives as `fixedTerms` (the "מונחים קבועים" row of the config sheet),
// so a term she adds there is corrected here, at the first stage that can see it, rather than
// only at the per-section rewrite three stages later. Empty when the row is missing — the
// prompt then reads exactly as it did before.
const CLEANUP_SYSTEM_PROMPT = (fixedTerms: string) => `המטרה: ניקוי תמלול בלבד.

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
המונחים עשויים לכלול מושגים כמו: מודעות פונולוגית, שליפה, קידוד שמיעתי, שטף קריאה, תנועות, צירופים וכדומה.

מילון תיקונים מחייב:
Whisper משבש באופן חוזר מונחים מקצועיים ושמות של שיטות ומשחקים מבית קמ"ש. תקן את הצורות הבאות בכל מופע:
- "חי"ת סופית" או "ח"ית סופית" ← "כ"ף סופית". אין בעברית אות חי"ת סופית; חמש האותיות הסופיות הן ך ם ן ף ץ.
- "ביסוס חושי" או "ביסוס חושים" ← "ויסות חושי".
- "אותיות גושות" ← "אותיות דגושות".
- "הסחתות דעת" ← "הסחות דעת".
- "סיכול אותיות" ← "שיכול אותיות", וכן "סיכול הגאים", "סיכול צלילים" ו"סיכול הברות". "סיכול" פירושו הכשלה ואינו מונח באבחון קריאה; המונח הוא שיכול, מלשון החלפת סדר.
- "בשיטת לב" ← "בשיטת ל"ב". זהו קיצור, לא המילה לב.
- "הליכה על קו לאגודל" ← "הליכה עקב לצד אגודל".
- משחק "רב-דב" ← משחק "רב-תו".
- "מפעפע" ← "מפי הטף". "ילדולס" ← "ילדודס". שניהם שמות של חוברות קומיקס.

טיפול במילים שלא זוהו:
- אם מילה או רצף מילים אינם מצטרפים למשמעות בעברית, אל תשאיר אותם כפי שהם ואל תמציא ניסוח שנשמע סביר במקומם.
- נסה לשחזר מה נאמר לפי ההקשר המקצועי של אבחון קריאה. אם אינך יכול לשחזר בוודאות, השאר את המילה כפי שתומללה והוסף מיד אחריה [לא ברור].
- הכלל הזה חשוב במיוחד בשמות של אותיות, שיטות, משחקים וחוברות, שבהם שגיאת תמלול יוצרת ממצא קליני שגוי.${
  fixedTerms
    ? `

מונחים קבועים של המכון:
המונחים הבאים הם המונחים המקצועיים התקניים, והאיות שמופיע כאן הוא האיות הנכון. תקן כל צורה חלופית שלהם בכל מופע, גם כאשר הצורה שתומללה היא מילה עברית תקינה בפני עצמה.
${fixedTerms}`
    : ""
}`;

function isMeaningful(text: string | undefined): text is string {
  return Boolean(text && text.trim());
}

export async function runStep1Pipeline(input: Step1PipelineInput): Promise<void> {
  const { jobId, folderId, recording, patient } = input;

  try {
    // 0. Transcribe (Whisper). Oversized recordings are re-encoded first to fit Whisper's
    //    25MB limit; a recording too long even after that fails the job here like any stage.
    const transcribable = await ensureTranscribable(recording.buffer, recording.filename);
    const rawTranscript = await transcribe(transcribable.buffer, transcribable.filename);

    // 1. Save raw transcript as a Drive Doc.
    await createDoc(folderId, `תמלול ${patient.name}`, rawTranscript);

    // 2. Clean transcript (spelling/punctuation only), with the clinic's term glossary.
    const fixedTerms = await getGeneralRule(FIXED_TERMS_RULE_TYPE);
    const cleanedTranscript = await chatComplete({
      system: CLEANUP_SYSTEM_PROMPT(fixedTerms),
      user: `זה הטקסט המתומלל:\n${rawTranscript}`,
    });
    await createDoc(folderId, `ניקוי תמלול ${patient.name}`, cleanedTranscript);

    // 3. Segment into the fixed JSON schema (personal details are NOT extracted here —
    //    they are built deterministically from the intake form in step 5).
    const segmented = await segmentToJson(cleanedTranscript);
    await uploadText(folderId, `חלוקה למקטעים-${jobId}.json`, JSON.stringify(segmented, null, 2), "application/json");
    await diagnosesRepo.updateByJobId(jobId, { [DIAGNOSES_COLUMNS.STATUS]: DiagnosisStatus.PROCESSING2 });

    // 4. Rewrite each non-empty section via Claude (formerly sub-workflow "עריכה ראשונית").
    const generalRules = await getGeneralRules();
    const rewritten: Record<string, string> = {};
    for (const [key, text] of Object.entries(segmented)) {
      if (!isMeaningful(text)) continue;
      const instructions = await getSectionInstructions(key);
      rewritten[key] = await rewriteSection({
        sectionText: text,
        editingInstructions: instructions?.editingInstructions ?? "",
        generalRules,
        patient: { name: patient.name, age: patient.age, school: patient.school, grade: patient.grade, city: patient.city },
        allowedSubheadings: instructions?.allowedSubheadings ?? "",
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
    //    then assemble deterministically (no LLM). Personal details are seeded first,
    //    built straight from the intake form — no LLM step touches them.
    const sectionHtmls: string[] = [buildPersonalDetailsHtml(patient)];
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
