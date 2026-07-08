import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { parseFileIdFromLink } from "../lib/driveLinks.js";
import { diagnosesRepo } from "../services/sheetsService.js";
import { uploadText } from "../services/driveService.js";
import { DIAGNOSES_COLUMNS } from "../config/sheets.js";

const bodySchema = z.object({
  jobId: z.string().min(1),
  content: z.string(),
});

export const editManuallyRouter = Router();

editManuallyRouter.post(
  "/editmanually",
  asyncHandler(async (req, res) => {
    const { jobId, content } = bodySchema.parse(req.body);

    const found = await diagnosesRepo.findByJobId(jobId);
    if (!found) {
      throw new HttpError(404, `No diagnosis found for jobId "${jobId}"`);
    }

    const folderLink = found.row[DIAGNOSES_COLUMNS.FOLDER];
    const folderId = parseFileIdFromLink(folderLink);

    const { link } = await uploadText(folderId, `edited-${Date.now()}.html`, content, "text/html");

    await diagnosesRepo.updateByRowNumber(found.rowNumber, {
      [DIAGNOSES_COLUMNS.LATEST_VERSION_HTML]: link,
    });

    res.json({ jobid: jobId, status: "ok" });
  }),
);
