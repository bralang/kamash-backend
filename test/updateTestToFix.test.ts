import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", () => ({
  parentQuestionnairesRepo: {
    findByName: vi.fn(),
    updateByRowNumber: vi.fn(),
  },
}));

import { createApp } from "../src/app.js";
import { parentQuestionnairesRepo } from "../src/services/sheetsService.js";
import { PARENT_QUESTIONNAIRES_COLUMNS } from "../src/config/sheets.js";

const app = createApp();

describe("POST /webhook/kamash/updateTestToFix", () => {
  beforeEach(() => {
    vi.mocked(parentQuestionnairesRepo.findByName).mockReset();
    vi.mocked(parentQuestionnairesRepo.updateByRowNumber).mockReset();
  });

  it("updates the matched row's fields and marks it הושלם", async () => {
    vi.mocked(parentQuestionnairesRepo.findByName).mockResolvedValue({
      rowNumber: 7,
      row: { [PARENT_QUESTIONNAIRES_COLUMNS.NAME]: "ליי וינרג" },
    });

    const res = await request(app).post("/webhook/kamash/updateTestToFix").send({
      patientName: "ליי וינרג",
      idNumber: "234567777",
      age: "7",
      school: "נמצ",
      grade: "עכג",
      date: "2026-03-17",
      city: "נמצ",
      mail: "L0533160990@GMAIL.COM",
    });

    expect(res.status).toBe(200);
    expect(parentQuestionnairesRepo.findByName).toHaveBeenCalledWith("ליי וינרג");
    expect(parentQuestionnairesRepo.updateByRowNumber).toHaveBeenCalledWith(7, {
      [PARENT_QUESTIONNAIRES_COLUMNS.NAME]: "ליי וינרג",
      [PARENT_QUESTIONNAIRES_COLUMNS.ID_NUMBER]: "234567777",
      [PARENT_QUESTIONNAIRES_COLUMNS.AGE]: "7",
      [PARENT_QUESTIONNAIRES_COLUMNS.GRADE]: "עכג",
      [PARENT_QUESTIONNAIRES_COLUMNS.SCHOOL]: "נמצ",
      [PARENT_QUESTIONNAIRES_COLUMNS.CITY]: "נמצ",
      [PARENT_QUESTIONNAIRES_COLUMNS.STATUS]: "הושלם",
    });
  });

  it("returns 404 when no pending questionnaire matches the name", async () => {
    vi.mocked(parentQuestionnairesRepo.findByName).mockResolvedValue(null);

    const res = await request(app)
      .post("/webhook/kamash/updateTestToFix")
      .send({ patientName: "מישהו שלא קיים", age: "5", school: "x", grade: "א", city: "y" });

    expect(res.status).toBe(404);
    expect(parentQuestionnairesRepo.updateByRowNumber).not.toHaveBeenCalled();
  });

  it("rejects a request missing the required patientName field", async () => {
    const res = await request(app).post("/webhook/kamash/updateTestToFix").send({ age: "5" });
    expect(res.status).toBe(400);
  });
});
