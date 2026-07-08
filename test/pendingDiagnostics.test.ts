import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", () => ({
  parentQuestionnairesRepo: {
    findPending: vi.fn(),
  },
}));

import { createApp } from "../src/app.js";
import { parentQuestionnairesRepo } from "../src/services/sheetsService.js";

const app = createApp();

describe("GET /kamash/pendingdiagnostics", () => {
  beforeEach(() => {
    vi.mocked(parentQuestionnairesRepo.findPending).mockReset();
  });

  it("returns the pending rows as a raw JSON array", async () => {
    const rows = [{ שם: "ילד א", סטטוס: "בהמתנה" }];
    vi.mocked(parentQuestionnairesRepo.findPending).mockResolvedValue(rows);

    const res = await request(app).get("/kamash/pendingdiagnostics");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
  });

  it("returns an empty array when nothing is pending", async () => {
    vi.mocked(parentQuestionnairesRepo.findPending).mockResolvedValue([]);

    const res = await request(app).get("/kamash/pendingdiagnostics");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
