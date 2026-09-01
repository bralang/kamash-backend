import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", () => ({
  diagnosesRepo: {
    findByJobId: vi.fn(),
    updateByRowNumber: vi.fn(),
  },
}));

import { createApp } from "../src/app.js";
import { diagnosesRepo } from "../src/services/sheetsService.js";
import { DIAGNOSES_COLUMNS } from "../src/config/sheets.js";

const app = createApp();

function mockRow() {
  vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue({
    rowNumber: 42,
    row: {
      [DIAGNOSES_COLUMNS.JOB_ID]: "abc123",
      [DIAGNOSES_COLUMNS.EMAIL]: "old@example.com",
    },
  });
}

describe("POST /webhook/kamash/updatemail", () => {
  beforeEach(() => {
    vi.mocked(diagnosesRepo.findByJobId).mockReset();
    vi.mocked(diagnosesRepo.updateByRowNumber).mockReset();
  });

  it("updates only the כתובת מייל לשליחת אבחון column on the matching row", async () => {
    mockRow();

    const res = await request(app)
      .post("/webhook/kamash/updatemail")
      .send({ jobId: "abc123", mail: "parent@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobid: "abc123", status: "ok" });

    expect(diagnosesRepo.findByJobId).toHaveBeenCalledWith("abc123");
    expect(diagnosesRepo.updateByRowNumber).toHaveBeenCalledWith(42, {
      [DIAGNOSES_COLUMNS.EMAIL]: "parent@example.com",
    });
  });

  it("clears the cell when mail is an empty string instead of skipping the write", async () => {
    mockRow();

    const res = await request(app).post("/webhook/kamash/updatemail").send({ jobId: "abc123", mail: "" });

    expect(res.status).toBe(200);
    expect(diagnosesRepo.updateByRowNumber).toHaveBeenCalledWith(42, {
      [DIAGNOSES_COLUMNS.EMAIL]: "",
    });
  });

  it("trims surrounding whitespace before writing", async () => {
    mockRow();

    const res = await request(app)
      .post("/webhook/kamash/updatemail")
      .send({ jobId: "abc123", mail: "  parent@example.com  " });

    expect(res.status).toBe(200);
    expect(diagnosesRepo.updateByRowNumber).toHaveBeenCalledWith(42, {
      [DIAGNOSES_COLUMNS.EMAIL]: "parent@example.com",
    });
  });

  it("returns 404 when no row matches the jobId", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue(null);

    const res = await request(app)
      .post("/webhook/kamash/updatemail")
      .send({ jobId: "does-not-exist", mail: "parent@example.com" });

    expect(res.status).toBe(404);
    expect(diagnosesRepo.updateByRowNumber).not.toHaveBeenCalled();
  });

  it("rejects a malformed address", async () => {
    const res = await request(app).post("/webhook/kamash/updatemail").send({ jobId: "abc123", mail: "not-an-email" });

    expect(res.status).toBe(400);
    expect(diagnosesRepo.updateByRowNumber).not.toHaveBeenCalled();
  });

  it("rejects a request missing required fields", async () => {
    const res = await request(app).post("/webhook/kamash/updatemail").send({ jobId: "abc123" });

    expect(res.status).toBe(400);
    expect(diagnosesRepo.updateByRowNumber).not.toHaveBeenCalled();
  });
});
