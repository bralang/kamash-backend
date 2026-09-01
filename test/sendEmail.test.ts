import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/emailService.js", () => ({
  sendDiagnosisEmail: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { sendDiagnosisEmail } from "../src/services/emailService.js";

const app = createApp();
const fakePdf = Buffer.from("%PDF-1.4 fake pdf content");

describe("POST /webhook/kamash/sendEmailWithDiagnosis", () => {
  beforeEach(() => {
    vi.mocked(sendDiagnosisEmail).mockReset();
    vi.mocked(sendDiagnosisEmail).mockResolvedValue(undefined);
  });

  it("sends only to the real recipient (no hardcoded test-address CC)", async () => {
    const res = await request(app)
      .post("/webhook/kamash/sendEmailWithDiagnosis?mail=parent@example.com")
      .field("data", JSON.stringify({ id: "1", patientName: "ילד א" }))
      .field("filename", "diagnosis-1.pdf")
      .attach("file", fakePdf, { filename: "diagnosis-1.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(sendDiagnosisEmail).toHaveBeenCalledTimes(1);
    expect(sendDiagnosisEmail).toHaveBeenCalledWith({
      to: "parent@example.com",
      attachment: {
        filename: "diagnosis-1.pdf",
        mimeType: "application/pdf",
        content: expect.any(Buffer),
      },
    });
  });

  it("fails loudly instead of silently no-op'ing when 'mail' is missing", async () => {
    const res = await request(app)
      .post("/webhook/kamash/sendEmailWithDiagnosis")
      .attach("file", fakePdf, { filename: "diagnosis-1.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(sendDiagnosisEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when no file is attached", async () => {
    const res = await request(app).post("/webhook/kamash/sendEmailWithDiagnosis?mail=parent@example.com");

    expect(res.status).toBe(400);
    expect(sendDiagnosisEmail).not.toHaveBeenCalled();
  });
});
