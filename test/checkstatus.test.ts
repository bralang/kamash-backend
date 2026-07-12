import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", () => ({
  diagnosesRepo: {
    findByJobId: vi.fn(),
  },
}));

vi.mock("../src/services/driveService.js", () => ({
  downloadFileText: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { diagnosesRepo } from "../src/services/sheetsService.js";
import { downloadFileText } from "../src/services/driveService.js";
import { DIAGNOSES_COLUMNS } from "../src/config/sheets.js";

const app = createApp();

describe("POST /webhook/kamash/checkstatus", () => {
  beforeEach(() => {
    vi.mocked(diagnosesRepo.findByJobId).mockReset();
    vi.mocked(downloadFileText).mockReset();
  });

  it("returns status only while processing (no content download)", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue({
      rowNumber: 3,
      row: { [DIAGNOSES_COLUMNS.STATUS]: "processing2" },
    });

    const res = await request(app).post("/webhook/kamash/checkstatus").send({ jobId: "abc" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobid: "abc", status: "processing2" });
    expect(downloadFileText).not.toHaveBeenCalled();
  });

  it("downloads and returns the report HTML once status is done", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue({
      rowNumber: 3,
      row: {
        [DIAGNOSES_COLUMNS.STATUS]: "done",
        [DIAGNOSES_COLUMNS.LATEST_VERSION_HTML]: "https://drive.google.com/file/d/FILE_1/edit",
      },
    });
    vi.mocked(downloadFileText).mockResolvedValue("<h2>סיכום אבחון</h2>");

    const res = await request(app).post("/webhook/kamash/checkstatus").send({ jobId: "abc" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobid: "abc", status: "done", content: "<h2>סיכום אבחון</h2>" });
    expect(downloadFileText).toHaveBeenCalledWith("https://drive.google.com/file/d/FILE_1/edit");
  });

  it("returns status only when failed, without erroring", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue({
      rowNumber: 3,
      row: { [DIAGNOSES_COLUMNS.STATUS]: "failed" },
    });

    const res = await request(app).post("/webhook/kamash/checkstatus").send({ jobId: "abc" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobid: "abc", status: "failed" });
  });

  it("returns 404 when no row matches the jobId", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue(null);

    const res = await request(app).post("/webhook/kamash/checkstatus").send({ jobId: "missing" });

    expect(res.status).toBe(404);
  });
});
