import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/driveService.js", () => ({
  createDoc: vi.fn().mockResolvedValue({ fileId: "DOC_1", link: "https://drive.google.com/file/d/DOC_1/edit" }),
  uploadText: vi.fn().mockResolvedValue({ fileId: "FILE_1", link: "https://drive.google.com/file/d/FILE_1/edit" }),
}));

vi.mock("../src/services/openaiService.js", () => ({
  chatComplete: vi.fn().mockResolvedValue("תמלול נקי"),
  segmentToJson: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("../src/services/audioService.js", () => ({
  ensureTranscribable: vi.fn(),
}));

vi.mock("../src/services/anthropicService.js", () => ({
  rewriteSection: vi.fn(),
}));

vi.mock("../src/services/configRepo.js", () => ({
  getGeneralRules: vi.fn().mockResolvedValue("כללי לשון כלליים"),
  getGeneralRule: vi.fn().mockResolvedValue("שיכול אותיות (ולא \"סיכול אותיות\")"),
  FIXED_TERMS_RULE_TYPE: "מונחים קבועים",
  getSectionInstructions: vi.fn().mockResolvedValue({
    sectionKeyEn: "referral_reason",
    sectionTitleHe: "סיבת הפנייה",
    editingInstructions: "ערוך בקצרה",
    formattingInstructions: "פסקה אחת",
    allowedSubheadings: "קריאה:\n• חיזוק שטף הקריאה",
  }),
}));

vi.mock("../src/services/htmlConversionService.js", () => ({
  sectionToHtml: vi.fn().mockResolvedValue('<section class="diagnosis-section">...</section>'),
  assembleDocument: vi.fn().mockReturnValue("<html>full document</html>"),
  buildPersonalDetailsHtml: vi.fn().mockReturnValue('<section class="diagnosis-section" data-section="פרטים אישיים">...</section>'),
}));

vi.mock("../src/services/sheetsService.js", () => ({
  diagnosesRepo: {
    updateByJobId: vi.fn().mockResolvedValue(undefined),
  },
  versionsRepo: {
    appendVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../src/services/pipeline/errorHandler.js", () => ({
  markJobFailed: vi.fn().mockResolvedValue(undefined),
}));

import { runStep1Pipeline } from "../src/services/pipeline/step1Pipeline.js";
import { getGeneralRule, FIXED_TERMS_RULE_TYPE } from "../src/services/configRepo.js";
import { chatComplete, segmentToJson, transcribe } from "../src/services/openaiService.js";
import { ensureTranscribable } from "../src/services/audioService.js";
import { createDoc } from "../src/services/driveService.js";
import { HttpError } from "../src/lib/httpError.js";
import { rewriteSection } from "../src/services/anthropicService.js";
import { sectionToHtml, assembleDocument, buildPersonalDetailsHtml } from "../src/services/htmlConversionService.js";
import { diagnosesRepo, versionsRepo } from "../src/services/sheetsService.js";
import { markJobFailed } from "../src/services/pipeline/errorHandler.js";
import { DIAGNOSES_COLUMNS } from "../src/config/sheets.js";

const patient = { name: "ילד א", age: "8", school: "בית ספר הגפן", grade: "ג", city: "בני ברק", date: "2026-02-20" };

const recording = { buffer: Buffer.from("fake webm bytes"), filename: "recording.webm" };

const segmented = {
  referral_reason: "הופנה בשל קשיי קריאה",
  general_impression: "",
  diagnosis_findings: "שטף 30 הברות לדקה",
  difficulties: "",
  work_plan: "",
  summary_and_recommendations: "",
  home_practice: "",
  goals: "",
  external_treatments: "",
};

describe("runStep1Pipeline", () => {
  beforeEach(() => {
    vi.mocked(segmentToJson).mockReset().mockResolvedValue(segmented);
    vi.mocked(rewriteSection).mockReset().mockResolvedValue("טקסט ערוך");
    vi.mocked(sectionToHtml).mockReset().mockResolvedValue('<section class="diagnosis-section">...</section>');
    vi.mocked(assembleDocument).mockReset().mockReturnValue("<html>full document</html>");
    vi.mocked(buildPersonalDetailsHtml)
      .mockReset()
      .mockReturnValue('<section class="diagnosis-section" data-section="פרטים אישיים">...</section>');
    vi.mocked(diagnosesRepo.updateByJobId).mockReset().mockResolvedValue(undefined);
    vi.mocked(versionsRepo.appendVersion).mockReset().mockResolvedValue(undefined);
    vi.mocked(markJobFailed).mockReset().mockResolvedValue(undefined);
    vi.mocked(chatComplete).mockReset().mockResolvedValue("תמלול נקי");
    vi.mocked(transcribe).mockReset().mockResolvedValue("תמלול גולמי");
    vi.mocked(ensureTranscribable)
      .mockReset()
      .mockImplementation(async (buffer, filename) => ({ buffer, filename }));
    vi.mocked(createDoc).mockClear();
    vi.mocked(getGeneralRule).mockReset().mockResolvedValue('שיכול אותיות (ולא "סיכול אותיות")');
  });

  it("runs the full chain, skips empty sections, and marks the job done", async () => {
    await runStep1Pipeline({ jobId: "job-1", folderId: "FOLDER_1", recording, patient });

    // Segmentation no longer receives the patient — personal details never touch the LLM.
    expect(segmentToJson).toHaveBeenCalledWith("תמלול נקי");

    // Only the 2 non-empty sections (referral_reason, diagnosis_findings) should have
    // been rewritten and converted to HTML — the 7 empty ones skipped.
    expect(rewriteSection).toHaveBeenCalledTimes(2);
    expect(sectionToHtml).toHaveBeenCalledTimes(2);

    // The closed sub-heading list from the config sheet is passed through to the rewrite.
    expect(rewriteSection).toHaveBeenCalledWith(
      expect.objectContaining({ allowedSubheadings: "קריאה:\n• חיזוק שטף הקריאה" }),
    );

    // Personal details are built deterministically from the intake form and placed first.
    expect(buildPersonalDetailsHtml).toHaveBeenCalledWith(patient);
    const assembledSections = vi.mocked(assembleDocument).mock.calls[0]?.[0];
    expect(assembledSections?.[0]).toBe('<section class="diagnosis-section" data-section="פרטים אישיים">...</section>');
    expect(assembledSections).toHaveLength(3);

    expect(diagnosesRepo.updateByJobId).toHaveBeenCalledWith("job-1", { [DIAGNOSES_COLUMNS.STATUS]: "processing2" });
    expect(versionsRepo.appendVersion).toHaveBeenCalledWith("job-1", 0, "FILE_1");
    expect(diagnosesRepo.updateByJobId).toHaveBeenCalledWith("job-1", {
      [DIAGNOSES_COLUMNS.LATEST_VERSION_HTML]: "https://drive.google.com/file/d/FILE_1/edit",
      [DIAGNOSES_COLUMNS.STATUS]: "done",
    });
    expect(markJobFailed).not.toHaveBeenCalled();
  });

  it("marks the job failed instead of throwing when a stage rejects", async () => {
    vi.mocked(rewriteSection).mockRejectedValue(new Error("Anthropic is down"));

    await expect(
      runStep1Pipeline({ jobId: "job-2", folderId: "FOLDER_1", recording, patient }),
    ).resolves.toBeUndefined();

    expect(markJobFailed).toHaveBeenCalledWith("job-2", expect.any(Error), "step1Pipeline");
  });

  it("transcribes the compressed audio, then saves and cleans that transcript", async () => {
    const compressed = Buffer.from("compressed");
    vi.mocked(ensureTranscribable).mockResolvedValue({ buffer: compressed, filename: "recording.ogg" });

    await runStep1Pipeline({ jobId: "job-6", folderId: "FOLDER_1", recording, patient });

    expect(ensureTranscribable).toHaveBeenCalledWith(recording.buffer, "recording.webm");
    expect(transcribe).toHaveBeenCalledWith(compressed, "recording.ogg");
    expect(createDoc).toHaveBeenCalledWith("FOLDER_1", `תמלול ${patient.name}`, "תמלול גולמי");
    expect(vi.mocked(chatComplete).mock.calls[0]?.[0]?.user).toContain("תמלול גולמי");
  });

  // Transcription now runs after step1 has already answered, so its failure can only reach
  // the diagnostician through the row's status — which is what /checkstatus polls.
  it("marks the job failed when transcription fails, before any later stage runs", async () => {
    vi.mocked(transcribe).mockRejectedValue(new Error("Whisper is down"));

    await expect(
      runStep1Pipeline({ jobId: "job-7", folderId: "FOLDER_1", recording, patient }),
    ).resolves.toBeUndefined();

    expect(markJobFailed).toHaveBeenCalledWith("job-7", expect.any(Error), "step1Pipeline");
    expect(createDoc).not.toHaveBeenCalled();
    expect(chatComplete).not.toHaveBeenCalled();
    expect(diagnosesRepo.updateByJobId).not.toHaveBeenCalled();
  });

  it("marks the job failed when the recording cannot be compressed enough for Whisper", async () => {
    vi.mocked(ensureTranscribable).mockRejectedValue(
      new HttpError(413, "Audio file is too large to transcribe even after compression."),
    );

    await expect(
      runStep1Pipeline({ jobId: "job-8", folderId: "FOLDER_1", recording, patient }),
    ).resolves.toBeUndefined();

    expect(transcribe).not.toHaveBeenCalled();
    expect(markJobFailed).toHaveBeenCalledWith("job-8", expect.any(HttpError), "step1Pipeline");
  });

  // The transcript-cleanup glossary exists because Whisper mis-transcribed these exact
  // terms in two separate real diagnoses. "חי"ת סופית" is not a Hebrew letter at all, and
  // "ביסוס חושי" for "ויסות חושי" changes a clinical finding — both reached the editor.
  it("sends the Kamash terminology glossary with the transcript cleanup call", async () => {
    vi.mocked(segmentToJson).mockResolvedValue(segmented);

    await runStep1Pipeline({ jobId: "job-3", folderId: "FOLDER_1", recording, patient });

    const cleanupCall = vi.mocked(chatComplete).mock.calls[0]?.[0];
    expect(cleanupCall?.user).toContain("תמלול גולמי");

    const prompt = cleanupCall?.system ?? "";
    expect(prompt).toContain('"כ"ף סופית"');
    expect(prompt).toContain("ויסות חושי");
    expect(prompt).toContain("שיכול אותיות");
    expect(prompt).toContain("ך ם ן ף ץ");
    expect(prompt).toContain("[לא ברור]");

    // The cleanup stage must still be forbidden from rewriting — the glossary is a
    // correction list, not a licence to edit.
    expect(prompt).toContain("ניקוי תמלול בלבד");
    expect(prompt).toContain("שכתוב סגנוני");
  });

  // The clinic maintains its own term list in the config sheet; without this it reached only
  // the per-section rewrite, three stages downstream, so segmentation routed content it had
  // already read under the wrong term. A term like "סיכול אותיות" for "שיכול אותיות" is spelled
  // correctly and cannot be caught by a generic "fix spelling" instruction — only by this list.
  it("appends the clinic's fixed-terms row from the config sheet to the cleanup prompt", async () => {
    await runStep1Pipeline({ jobId: "job-4", folderId: "FOLDER_1", recording, patient });

    expect(getGeneralRule).toHaveBeenCalledWith(FIXED_TERMS_RULE_TYPE);
    const prompt = vi.mocked(chatComplete).mock.calls[0]?.[0]?.system ?? "";
    expect(prompt).toContain('שיכול אותיות (ולא "סיכול אותיות")');
    expect(prompt).toContain("מונחים קבועים של המכון");
    // The hardcoded glossary is additive, not replaced by the sheet.
    expect(prompt).toContain("ויסות חושי");
  });

  it("leaves the cleanup prompt unchanged when the sheet has no fixed-terms row", async () => {
    vi.mocked(getGeneralRule).mockResolvedValue("");

    await runStep1Pipeline({ jobId: "job-5", folderId: "FOLDER_1", recording, patient });

    const prompt = vi.mocked(chatComplete).mock.calls[0]?.[0]?.system ?? "";
    expect(prompt).not.toContain("מונחים קבועים של המכון");
    expect(prompt).toContain("ויסות חושי");
  });
});
