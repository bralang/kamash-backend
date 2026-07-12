import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", () => ({
  diagnosesRepo: {
    findAll: vi.fn(),
  },
}));

import { createApp } from "../src/app.js";
import { diagnosesRepo } from "../src/services/sheetsService.js";

const app = createApp();

describe("GET /webhook/kamash/prevdiagnostics", () => {
  beforeEach(() => {
    vi.mocked(diagnosesRepo.findAll).mockReset();
  });

  it("returns every diagnosis row as a raw JSON array", async () => {
    const rows = [{ jobid: "1", status: "done", "שם המאובחן": "ילד א" }];
    vi.mocked(diagnosesRepo.findAll).mockResolvedValue(rows);

    const res = await request(app).get("/webhook/kamash/prevdiagnostics");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
  });
});
