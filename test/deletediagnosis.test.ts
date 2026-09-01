import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", () => ({
  diagnosesRepo: {
    findByJobId: vi.fn(),
    updateByRowNumber: vi.fn(),
  },
}));

vi.mock("../src/services/driveService.js", () => ({
  trashFolder: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { diagnosesRepo } from "../src/services/sheetsService.js";
import { trashFolder } from "../src/services/driveService.js";
import { DIAGNOSES_COLUMNS, DiagnosisStatus } from "../src/config/sheets.js";

const app = createApp();

const FOLDER_LINK = "https://drive.google.com/drive/u/0/folders/FOLDER_ID_1";

function mockRow(folderLink: string = FOLDER_LINK) {
  vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue({
    rowNumber: 42,
    row: {
      [DIAGNOSES_COLUMNS.JOB_ID]: "abc123",
      [DIAGNOSES_COLUMNS.FOLDER]: folderLink,
      [DIAGNOSES_COLUMNS.STATUS]: DiagnosisStatus.DONE,
    },
  });
}

describe("POST /webhook/kamash/deletediagnosis", () => {
  beforeEach(() => {
    vi.mocked(diagnosesRepo.findByJobId).mockReset();
    vi.mocked(diagnosesRepo.updateByRowNumber).mockReset();
    vi.mocked(trashFolder).mockReset();
  });

  it("removes the Drive folder and sets only status to deleted", async () => {
    mockRow();
    vi.mocked(trashFolder).mockResolvedValue(true);

    const res = await request(app).post("/webhook/kamash/deletediagnosis").send({ jobId: "abc123" });

    expect(res.status).toBe(200);
    expect(trashFolder).toHaveBeenCalledWith("FOLDER_ID_1");
    expect(diagnosesRepo.updateByRowNumber).toHaveBeenCalledWith(42, {
      [DIAGNOSES_COLUMNS.STATUS]: "deleted",
    });
  });

  it("still marks the row deleted when the folder is already gone from Drive", async () => {
    mockRow();
    vi.mocked(trashFolder).mockResolvedValue(false);

    const res = await request(app).post("/webhook/kamash/deletediagnosis").send({ jobId: "abc123" });

    expect(res.status).toBe(200);
    expect(diagnosesRepo.updateByRowNumber).toHaveBeenCalledWith(42, {
      [DIAGNOSES_COLUMNS.STATUS]: "deleted",
    });
  });

  it("marks the row deleted without touching Drive when תיקיה is empty", async () => {
    mockRow("");

    const res = await request(app).post("/webhook/kamash/deletediagnosis").send({ jobId: "abc123" });

    expect(res.status).toBe(200);
    expect(trashFolder).not.toHaveBeenCalled();
    expect(diagnosesRepo.updateByRowNumber).toHaveBeenCalledWith(42, {
      [DIAGNOSES_COLUMNS.STATUS]: "deleted",
    });
  });

  it("marks the row deleted when the תיקיה link is unparseable", async () => {
    mockRow("not-a-drive-link");

    const res = await request(app).post("/webhook/kamash/deletediagnosis").send({ jobId: "abc123" });

    expect(res.status).toBe(200);
    expect(trashFolder).not.toHaveBeenCalled();
    expect(diagnosesRepo.updateByRowNumber).toHaveBeenCalledWith(42, {
      [DIAGNOSES_COLUMNS.STATUS]: "deleted",
    });
  });

  it("leaves the row untouched when Drive fails for a reason other than 'already gone'", async () => {
    mockRow();
    vi.mocked(trashFolder).mockRejectedValue(new Error("insufficient permissions"));

    const res = await request(app).post("/webhook/kamash/deletediagnosis").send({ jobId: "abc123" });

    expect(res.status).toBe(500);
    expect(diagnosesRepo.updateByRowNumber).not.toHaveBeenCalled();
  });

  it("returns 404 when no row matches the jobId", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue(null);

    const res = await request(app).post("/webhook/kamash/deletediagnosis").send({ jobId: "does-not-exist" });

    expect(res.status).toBe(404);
    expect(trashFolder).not.toHaveBeenCalled();
    expect(diagnosesRepo.updateByRowNumber).not.toHaveBeenCalled();
  });

  it("rejects a request with no jobId", async () => {
    const res = await request(app).post("/webhook/kamash/deletediagnosis").send({});

    expect(res.status).toBe(400);
    expect(trashFolder).not.toHaveBeenCalled();
    expect(diagnosesRepo.updateByRowNumber).not.toHaveBeenCalled();
  });
});
