import { diagnosesRepo } from "../sheetsService.js";
import { DIAGNOSES_COLUMNS, DiagnosisStatus } from "../../config/sheets.js";
import { logger } from "../../lib/logger.js";

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/** Self-healing improvement n8n never had: on boot, any job stuck in processing/
 * processing2 past the threshold (e.g. because the process crashed mid-pipeline) is
 * flipped to failed instead of showing "processing" forever in the dashboard. */
export async function sweepStaleJobs(): Promise<void> {
  const rows = await diagnosesRepo.findAll();
  const now = Date.now();

  for (const row of rows) {
    const status = row[DIAGNOSES_COLUMNS.STATUS];
    if (status !== DiagnosisStatus.PROCESSING && status !== DiagnosisStatus.PROCESSING2) continue;

    const timestamp = Date.parse(row[DIAGNOSES_COLUMNS.TIMESTAMP]);
    if (Number.isNaN(timestamp) || now - timestamp < STALE_THRESHOLD_MS) continue;

    const jobId = row[DIAGNOSES_COLUMNS.JOB_ID];
    logger.warn({ jobId, status }, "Marking stale diagnosis job as failed on boot sweep");
    await diagnosesRepo.updateByJobId(jobId, { [DIAGNOSES_COLUMNS.STATUS]: DiagnosisStatus.FAILED });
  }
}
