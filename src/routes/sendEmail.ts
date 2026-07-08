import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { upload } from "../middleware/upload.js";
import { HttpError } from "../lib/httpError.js";
import { sendDiagnosisEmail } from "../services/emailService.js";

const querySchema = z.object({
  mail: z.string().email().optional(),
});

export const sendEmailRouter = Router();

sendEmailRouter.post(
  "/sendEmailWithDiagnosis",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { mail } = querySchema.parse(req.query);

    // The original n8n workflow unconditionally CC'd a hardcoded test address on every
    // send in parallel with the real conditional send to `mail` — that branch is dropped
    // here (per decision), leaving only the real send. With no other recipient, a request
    // missing `mail` now fails loudly (400) instead of the frontend showing a false
    // "sent successfully" toast for an email that silently went nowhere.
    if (!mail) {
      throw new HttpError(400, "Missing required 'mail' query parameter");
    }
    if (!req.file) {
      throw new HttpError(400, "Missing required 'file' attachment");
    }

    const filename = (req.body?.filename as string | undefined) || req.file.originalname;

    await sendDiagnosisEmail({
      to: mail,
      attachment: { filename, mimeType: req.file.mimetype, content: req.file.buffer },
    });

    res.json({ status: "ok" });
  }),
);
