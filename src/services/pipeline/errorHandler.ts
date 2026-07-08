import { diagnosesRepo } from "../sheetsService.js";
import { DIAGNOSES_COLUMNS, DiagnosisStatus } from "../../config/sheets.js";
import { logger } from "../../lib/logger.js";

/** Replaces n8n's "אם האבחון נכשל" error-trigger workflow: any thrown error at any stage
 * of the step1 pipeline lands here and flips the job to failed, with far better
 * diagnosability (stage + full error) than n8n's error workflow ever had. */
export async function markJobFailed(jobId: string, err: unknown, stage: string): Promise<void> {
  logger.error({ jobId, stage, err }, "step1 pipeline stage failed — marking job failed");
  try {
    await diagnosesRepo.updateByJobId(jobId, { [DIAGNOSES_COLUMNS.STATUS]: DiagnosisStatus.FAILED });
  } catch (updateErr) {
    logger.error({ jobId, updateErr }, "Failed to mark job as failed after a pipeline error");
  }
}
