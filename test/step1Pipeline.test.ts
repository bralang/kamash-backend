import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/driveService.js", () => ({
  createDoc: vi.fn().mockResolvedValue({ fileId: "DOC_1", link: "https://drive.google.com/file/d/DOC_1/edit" }),
  uploadText: vi.fn().mockResolvedValue({ fileId: "FILE_1", link: "https://drive.google.com/file/d/FILE_1/edit" }),
}));

vi.mock("../src/services/openaiService.js", () => ({
  chatComplete: vi.fn().mockResolvedValue("תמלול נקי"),
  segmentToJson: vi.fn(),
}));

vi.mock("../src/services/anthropicService.js", () => ({
  rewriteSection: vi.fn(),
}));

vi.mock("../src/services/configRepo.js", () => ({
  getGeneralRules: vi.fn().mockResolvedValue("כללי לשון כלליים"),
  getSectionInstructions: vi.fn().mockResolvedValue({
    sectionKeyEn: "referral_reason",
    sectionTitleHe: "סיבת הפנייה",
    editingInstructions: "ערוך בקצרה",
    formattingInstructions: "פסקה אחת",
  }),
}));

vi.mock("../src/services/htmlConversionService.js", () => ({
  sectionToHtml: vi.fn().mockResolvedValue('<section class="diagnosis-section">...</section>'),
  assembleDocument: vi.fn().mockReturnValue("<html>full document</html>"),
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
import { segmentToJson } from "../src/services/openaiService.js";
import { rewriteSection } from "../src/services/anthropicService.js";
import { sectionToHtml, assembleDocument } from "../src/services/htmlConversionService.js";
import { diagnosesRepo, versionsRepo } from "../src/services/sheetsService.js";
import { markJobFailed } from "../src/services/pipeline/errorHandler.js";
import { DIAGNOSES_COLUMNS } from "../src/config/sheets.js";

const patient = { name: "ילד א", age: "8", school: "בית ספר הגפן", grade: "ג", city: "בני ברק", date: "2026-02-20" };

const segmented = {
  personal_details: { name: "ילד א", age: "8", grade: "ג", school: "בית ספר הגפן", city: "בני ברק", diagnosis_date: "2026-02-20" },
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
    vi.mocked(diagnosesRepo.updateByJobId).mockReset().mockResolvedValue(undefined);
    vi.mocked(versionsRepo.appendVersion).mockReset().mockResolvedValue(undefined);
    vi.mocked(markJobFailed).mockReset().mockResolvedValue(undefined);
  });

  it("runs the full chain, skips empty sections, and marks the job done", async () => {
    await runStep1Pipeline({ jobId: "job-1", folderId: "FOLDER_1", rawTranscript: "תמלול גולמי", patient });

    // Only the 3 non-empty sections (personal_details, referral_reason, diagnosis_findings)
    // should have been rewritten and converted to HTML — the 7 empty ones skipped.
    expect(rewriteSection).toHaveBeenCalledTimes(3);
    expect(sectionToHtml).toHaveBeenCalledTimes(3);

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
      runStep1Pipeline({ jobId: "job-2", folderId: "FOLDER_1", rawTranscript: "תמלול גולמי", patient }),
    ).resolves.toBeUndefined();

    expect(markJobFailed).toHaveBeenCalledWith("job-2", expect.any(Error), "step1Pipeline");
  });
});
