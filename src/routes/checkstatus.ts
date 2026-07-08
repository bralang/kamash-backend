import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { diagnosesRepo } from "../services/sheetsService.js";
import { downloadFileText } from "../services/driveService.js";
import { DIAGNOSES_COLUMNS, DiagnosisStatus } from "../config/sheets.js";

const bodySchema = z.object({ jobId: z.string().min(1) });

export const checkstatusRouter = Router();

checkstatusRouter.post(
  "/checkstatus",
  asyncHandler(async (req, res) => {
    const { jobId } = bodySchema.parse(req.body);

    const found = await diagnosesRepo.findByJobId(jobId);
    if (!found) {
      throw new HttpError(404, `No diagnosis found for jobId "${jobId}"`);
    }

    const status = found.row[DIAGNOSES_COLUMNS.STATUS];
    if (status === DiagnosisStatus.DONE) {
      const content = await downloadFileText(found.row[DIAGNOSES_COLUMNS.LATEST_VERSION_HTML]);
      res.json({ jobid: jobId, status, content });
      return;
    }

    // Covers processing/processing2/failed — the frontend already treats any non-done,
    // non-failed value as "keep polling", so passing these through unchanged is safe.
    res.json({ jobid: jobId, status });
  }),
);
