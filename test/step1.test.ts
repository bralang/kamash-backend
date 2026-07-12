import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/driveService.js", () => ({
  createPatientFolder: vi.fn(),
  uploadBinary: vi.fn(),
}));

vi.mock("../src/services/openaiService.js", () => ({
  transcribe: vi.fn(),
}));

vi.mock("../src/services/sheetsService.js", () => ({
  diagnosesRepo: {
    appendDiagnosis: vi.fn(),
  },
}));

vi.mock("../src/services/pipeline/step1Pipeline.js", () => ({
  runStep1Pipeline: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { createPatientFolder, uploadBinary } from "../src/services/driveService.js";
import { transcribe } from "../src/services/openaiService.js";
import { diagnosesRepo } from "../src/services/sheetsService.js";
import { runStep1Pipeline } from "../src/services/pipeline/step1Pipeline.js";
import { DIAGNOSES_COLUMNS } from "../src/config/sheets.js";

const app = createApp();
const fakeAudio = Buffer.from("fake webm bytes");

describe("POST /webhook/kamash/step1", () => {
  beforeEach(() => {
    vi.mocked(createPatientFolder).mockReset().mockResolvedValue({
      fileId: "FOLDER_1",
      link: "https://drive.google.com/drive/u/0/folders/FOLDER_1",
    });
    vi.mocked(uploadBinary).mockReset().mockResolvedValue({
      fileId: "REC_FILE_1",
      link: "https://drive.google.com/file/d/REC_FILE_1/edit",
    });
    vi.mocked(transcribe).mockReset().mockResolvedValue("זה התמלול הגולמי");
    vi.mocked(diagnosesRepo.appendDiagnosis).mockReset().mockResolvedValue(undefined);
    vi.mocked(runStep1Pipeline).mockReset().mockResolvedValue(undefined);
  });

  it("creates the patient folder, appends a processing row, responds immediately, and kicks off the background pipeline", async () => {
    const res = await request(app)
      .post("/webhook/kamash/step1")
      .field("patientName", "ילד א")
      .field("age", "8")
      .field("school", "בית ספר הגפן")
      .field("grade", "ג")
      .field("date", "2026-02-20")
      .field("id", "123456789")
      .field("city", "בני ברק")
      .field("mail", "parent@example.com")
      .attach("audioFile", fakeAudio, { filename: "recording.webm", contentType: "audio/webm" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobid: expect.any(String), status: "processing" });

    expect(createPatientFolder).toHaveBeenCalledWith("ילד א", expect.any(String));
    expect(uploadBinary).toHaveBeenCalledWith("FOLDER_1", "recording.webm", expect.any(Buffer), "audio/webm");
    expect(transcribe).toHaveBeenCalledWith(expect.any(Buffer), "recording.webm");

    expect(diagnosesRepo.appendDiagnosis).toHaveBeenCalledWith(
      expect.objectContaining({
        [DIAGNOSES_COLUMNS.PATIENT_NAME]: "ילד א",
        [DIAGNOSES_COLUMNS.AGE]: "8",
        [DIAGNOSES_COLUMNS.STATUS]: "processing",
        [DIAGNOSES_COLUMNS.FOLDER]: "https://drive.google.com/drive/u/0/folders/FOLDER_1",
      }),
    );

    // Background pipeline is fire-and-forget but should still have been invoked by the
    // time the request completes, since it's called synchronously before res.json returns.
    expect(runStep1Pipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: "FOLDER_1",
        rawTranscript: "זה התמלול הגולמי",
        patient: expect.objectContaining({ name: "ילד א" }),
      }),
    );
  });

  it("rejects an audio format Whisper doesn't accept", async () => {
    const res = await request(app)
      .post("/webhook/kamash/step1")
      .field("patientName", "ילד א")
      .attach("audioFile", fakeAudio, { filename: "recording.mov", contentType: "video/quicktime" });

    expect(res.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
    expect(diagnosesRepo.appendDiagnosis).not.toHaveBeenCalled();
  });

  it("rejects a request with no audio file at all", async () => {
    const res = await request(app).post("/webhook/kamash/step1").field("patientName", "ילד א");

    expect(res.status).toBe(400);
    expect(createPatientFolder).not.toHaveBeenCalled();
  });
});
