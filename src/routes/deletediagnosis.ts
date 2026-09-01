import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { logger } from "../lib/logger.js";
import { tryParseFileIdFromLink } from "../lib/driveLinks.js";
import { diagnosesRepo } from "../services/sheetsService.js";
import { trashFolder } from "../services/driveService.js";
import { DIAGNOSES_COLUMNS, DiagnosisStatus } from "../config/sheets.js";

const bodySchema = z.object({ jobId: z.string().min(1) });

export const deleteDiagnosisRouter = Router();

deleteDiagnosisRouter.post(
  "/deletediagnosis",
  asyncHandler(async (req, res) => {
    const { jobId } = bodySchema.parse(req.body);

    const found = await diagnosesRepo.findByJobId(jobId);
    if (!found) {
      throw new HttpError(404, `No diagnosis found for jobId "${jobId}"`);
    }

    // A row whose folder is already gone (deleted by hand in Drive) or whose תיקיה cell
    // was never filled in must still be removable from the dashboard — otherwise it is
    // stuck in the list forever with no way out. Both cases log and carry on; only a
    // *real* Drive failure (permissions, network) throws, so the row survives to be
    // retried instead of vanishing from the UI while its files stay on Drive.
    const folderId = tryParseFileIdFromLink(found.row[DIAGNOSES_COLUMNS.FOLDER] ?? "");
    if (!folderId) {
      logger.warn(
        { jobId, folderLink: found.row[DIAGNOSES_COLUMNS.FOLDER] },
        "Diagnosis row has no usable תיקיה link — marking deleted without touching Drive",
      );
    } else if (!(await trashFolder(folderId))) {
      logger.warn({ jobId, folderId }, "Drive folder already gone — marking the row deleted anyway");
    }

    // Awaited before responding: the frontend reloads the list the moment it sees a 2xx,
    // so returning early would race the write and make the row flicker back into the list.
    await diagnosesRepo.updateByRowNumber(found.rowNumber, {
      [DIAGNOSES_COLUMNS.STATUS]: DiagnosisStatus.DELETED,
    });

    res.json({ jobid: jobId, status: DiagnosisStatus.DELETED });
  }),
);
