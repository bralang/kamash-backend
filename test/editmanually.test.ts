import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", () => ({
  diagnosesRepo: {
    findByJobId: vi.fn(),
    updateByRowNumber: vi.fn(),
  },
}));

vi.mock("../src/services/driveService.js", () => ({
  uploadText: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { diagnosesRepo } from "../src/services/sheetsService.js";
import { uploadText } from "../src/services/driveService.js";
import { DIAGNOSES_COLUMNS } from "../src/config/sheets.js";

const app = createApp();

describe("POST /webhook/kamash/editmanually", () => {
  beforeEach(() => {
    vi.mocked(diagnosesRepo.findByJobId).mockReset();
    vi.mocked(diagnosesRepo.updateByRowNumber).mockReset();
    vi.mocked(uploadText).mockReset();
  });

  it("uploads the content into the patient's folder and updates only גרסא אחרונה html", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue({
      rowNumber: 42,
      row: {
        [DIAGNOSES_COLUMNS.JOB_ID]: "abc123",
        [DIAGNOSES_COLUMNS.FOLDER]: "https://drive.google.com/drive/u/0/folders/FOLDER_ID_1",
      },
    });
    vi.mocked(uploadText).mockResolvedValue({
      fileId: "FILE_ID_1",
      link: "https://drive.google.com/file/d/FILE_ID_1/edit",
    });

    const res = await request(app)
      .post("/webhook/kamash/editmanually")
      .send({ jobId: "abc123", content: "<p>שלום</p>" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobid: "abc123", status: "ok" });

    expect(uploadText).toHaveBeenCalledWith(
      "FOLDER_ID_1",
      expect.stringMatching(/^edited-\d+\.html$/),
      "<p>שלום</p>",
      "text/html",
    );
    expect(diagnosesRepo.updateByRowNumber).toHaveBeenCalledWith(42, {
      [DIAGNOSES_COLUMNS.LATEST_VERSION_HTML]: "https://drive.google.com/file/d/FILE_ID_1/edit",
    });
  });

  it("returns 404 when no row matches the jobId", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue(null);

    const res = await request(app)
      .post("/webhook/kamash/editmanually")
      .send({ jobId: "does-not-exist", content: "<p>x</p>" });

    expect(res.status).toBe(404);
    expect(uploadText).not.toHaveBeenCalled();
    expect(diagnosesRepo.updateByRowNumber).not.toHaveBeenCalled();
  });

  it("rejects a request missing required fields", async () => {
    const res = await request(app).post("/webhook/kamash/editmanually").send({ jobId: "abc123" });
    expect(res.status).toBe(400);
  });
});
