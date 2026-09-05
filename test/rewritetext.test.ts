import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", () => ({
  diagnosesRepo: {
    findByJobId: vi.fn(),
  },
}));

vi.mock("../src/services/configRepo.js", () => ({
  getGeneralRules: vi.fn(),
  getSectionInstructions: vi.fn(),
  getSectionInstructionsByTitle: vi.fn(),
}));

vi.mock("../src/services/anthropicService.js", () => ({
  rewriteSection: vi.fn(),
  rewriteSnippet: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { diagnosesRepo } from "../src/services/sheetsService.js";
import { getGeneralRules, getSectionInstructionsByTitle } from "../src/services/configRepo.js";
import { rewriteSnippet } from "../src/services/anthropicService.js";
import { resetRateLimits } from "../src/lib/rateLimit.js";
import { DIAGNOSES_COLUMNS } from "../src/config/sheets.js";

const app = createApp();

const ROW = {
  rowNumber: 7,
  row: {
    [DIAGNOSES_COLUMNS.JOB_ID]: "job-1",
    [DIAGNOSES_COLUMNS.PATIENT_NAME]: "יוסי כהן",
    [DIAGNOSES_COLUMNS.AGE]: "8",
    [DIAGNOSES_COLUMNS.SCHOOL]: "בית ספר הגפן",
    [DIAGNOSES_COLUMNS.GRADE]: "ג׳",
    [DIAGNOSES_COLUMNS.CITY]: "ירושלים",
  },
};

describe("POST /webhook/kamash/rewritetext", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.mocked(diagnosesRepo.findByJobId).mockReset();
    vi.mocked(getGeneralRules).mockReset();
    vi.mocked(getSectionInstructionsByTitle).mockReset();
    vi.mocked(rewriteSnippet).mockReset();

    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue(ROW);
    vi.mocked(getGeneralRules).mockResolvedValue("# כללי לשון\n\n- לשון עבר");
    vi.mocked(getSectionInstructionsByTitle).mockResolvedValue(null);
  });

  it("rewrites a plain-text snippet with the clinic rules and the row's patient context", async () => {
    vi.mocked(getSectionInstructionsByTitle).mockResolvedValue({
      sectionKeyEn: "diagnosis_findings",
      sectionTitleHe: "ממצאי האבחון",
      editingInstructions: "לפרט מדדים כמותיים",
      formattingInstructions: "",
      allowedSubheadings: "",
    });
    vi.mocked(rewriteSnippet).mockResolvedValue("הנבדק הציג קריאה תקינה לגילו.");

    const res = await request(app).post("/webhook/kamash/rewritetext").send({
      jobId: "job-1",
      shape: "text",
      sectionTitle: "ממצאי האבחון",
      instruction: "רככי את הניסוח",
      presetId: "soften",
      content: "הילד קרא בסדר.",
      attempt: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: "הנבדק הציג קריאה תקינה לגילו." });

    // The Hebrew data-section title is the only section identifier the document
    // carries, so the lookup has to go through the by-title accessor.
    expect(getSectionInstructionsByTitle).toHaveBeenCalledWith("ממצאי האבחון");
    expect(rewriteSnippet).toHaveBeenCalledWith({
      shape: "text",
      content: "הילד קרא בסדר.",
      instruction: "רככי את הניסוח",
      previous: undefined,
      generalRules: "# כללי לשון\n\n- לשון עבר",
      sectionInstructions: "לפרט מדדים כמותיים",
      patient: {
        name: "יוסי כהן",
        age: "8",
        school: "בית ספר הגפן",
        grade: "ג׳",
        city: "ירושלים",
      },
    });
  });

  it("passes a block snippet through as HTML and strips a wrapping markdown fence", async () => {
    vi.mocked(rewriteSnippet).mockResolvedValue("```html\n<p>פסקה ראשונה.</p><p>פסקה שנייה.</p>\n```");

    const res = await request(app).post("/webhook/kamash/rewritetext").send({
      jobId: "job-1",
      shape: "flow",
      content: "<p>ראשונה.</p><p>שנייה.</p>",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: "<p>פסקה ראשונה.</p><p>פסקה שנייה.</p>" });
    expect(vi.mocked(rewriteSnippet).mock.calls[0][0]).toMatchObject({
      shape: "flow",
      content: "<p>ראשונה.</p><p>שנייה.</p>",
      // No section on this request — the rewrite still runs on the general rules.
      sectionInstructions: undefined,
    });
    expect(getSectionInstructionsByTitle).not.toHaveBeenCalled();
  });

  it("rejects an over-long snippet before any model call", async () => {
    const res = await request(app)
      .post("/webhook/kamash/rewritetext")
      .send({ jobId: "job-1", shape: "text", content: "א".repeat(4001) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOO_LONG");
    expect(rewriteSnippet).not.toHaveBeenCalled();
    expect(diagnosesRepo.findByJobId).not.toHaveBeenCalled();
  });

  it("rejects an empty snippet before any model call", async () => {
    const res = await request(app)
      .post("/webhook/kamash/rewritetext")
      .send({ jobId: "job-1", shape: "text", content: "   \n  " });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMPTY_INPUT");
    expect(rewriteSnippet).not.toHaveBeenCalled();
  });

  it("returns 404 when no row matches the jobId, without calling the model", async () => {
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue(null);

    const res = await request(app)
      .post("/webhook/kamash/rewritetext")
      .send({ jobId: "does-not-exist", shape: "text", content: "טקסט כלשהו" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
    expect(rewriteSnippet).not.toHaveBeenCalled();
  });

  it("rejects a request missing required fields", async () => {
    const res = await request(app).post("/webhook/kamash/rewritetext").send({ jobId: "job-1", content: "טקסט" });
    expect(res.status).toBe(400);
    expect(rewriteSnippet).not.toHaveBeenCalled();
  });

  it("rate-limits per jobId once the window is exhausted", async () => {
    // Unknown jobId keeps each request cheap (404, no model call) while still
    // consuming quota — the limit is enforced before the row lookup on purpose,
    // so probing jobIds is bounded too.
    vi.mocked(diagnosesRepo.findByJobId).mockResolvedValue(null);
    const send = () =>
      request(app).post("/webhook/kamash/rewritetext").send({ jobId: "hot-job", shape: "text", content: "טקסט" });

    for (let i = 0; i < 30; i++) {
      expect((await send()).status).toBe(404);
    }

    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");

    // A different document is unaffected by another one's exhausted window.
    const other = await request(app)
      .post("/webhook/kamash/rewritetext")
      .send({ jobId: "cold-job", shape: "text", content: "טקסט" });
    expect(other.status).toBe(404);
  });
});
