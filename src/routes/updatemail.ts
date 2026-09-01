import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { diagnosesRepo } from "../services/sheetsService.js";
import { DIAGNOSES_COLUMNS } from "../config/sheets.js";

// `mail` is required but may be the empty string — that means "clear the cell", not
// "skip the write", so it is deliberately not `.optional()` / `.min(1)`. A non-empty
// value must still look like an address: this column is what sendEmailWithDiagnosis
// ultimately sends to, so a typo saved here fails later and further from the user.
const bodySchema = z.object({
  jobId: z.string().min(1),
  mail: z
    .string()
    .trim()
    .refine((value) => value === "" || z.string().email().safeParse(value).success, {
      message: "mail must be a valid email address or an empty string",
    }),
});

export const updateMailRouter = Router();

updateMailRouter.post(
  "/updatemail",
  asyncHandler(async (req, res) => {
    const { jobId, mail } = bodySchema.parse(req.body);

    const found = await diagnosesRepo.findByJobId(jobId);
    if (!found) {
      throw new HttpError(404, `No diagnosis found for jobId "${jobId}"`);
    }

    await diagnosesRepo.updateByRowNumber(found.rowNumber, {
      [DIAGNOSES_COLUMNS.EMAIL]: mail,
    });

    res.json({ jobid: jobId, status: "ok" });
  }),
);
