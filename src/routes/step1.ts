import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { upload } from "../middleware/upload.js";
import { HttpError } from "../lib/httpError.js";
import { generateJobId } from "../lib/ids.js";
import { createPatientFolder, uploadBinary } from "../services/driveService.js";
import { ensureTranscribable } from "../services/audioService.js";
import { transcribe } from "../services/openaiService.js";
import { diagnosesRepo } from "../services/sheetsService.js";
import { runStep1Pipeline } from "../services/pipeline/step1Pipeline.js";
import { DIAGNOSES_COLUMNS, DiagnosisStatus } from "../config/sheets.js";
import { logger } from "../lib/logger.js";

// Whisper only accepts these container formats — reject anything else up front instead
// of letting the transcription call fail deep in the pipeline (the frontend's own
// client-side check is a looser `audio/*`, so this can still legitimately reject files
// the frontend accepted).
const WHISPER_ACCEPTED_MIME_TYPES = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp3",
  "audio/mpeg",
  "audio/mp4",
  "audio/mpga",
  "audio/oga",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

const bodySchema = z.object({
  patientName: z.string().min(1),
  age: z.string().default(""),
  school: z.string().default(""),
  grade: z.string().default(""),
  date: z.string().default(""),
  id: z.string().default(""),
  city: z.string().default(""),
  mail: z.string().default(""),
});

export const step1Router = Router();

step1Router.post(
  "/step1",
  upload.fields([
    { name: "audioFile", maxCount: 1 },
    { name: "transcriptFile", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const fields = bodySchema.parse(req.body);

    // Whichever of these is present is always raw audio (never pre-transcribed text) —
    // "transcriptFile" is a legacy/misleading field name from the frontend, kept for
    // request-shape compatibility only.
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const record = files?.audioFile?.[0] ?? files?.transcriptFile?.[0];
    if (!record) {
      throw new HttpError(400, "Missing required audio recording (audioFile or transcriptFile)");
    }
    if (!WHISPER_ACCEPTED_MIME_TYPES.has(record.mimetype)) {
      throw new HttpError(
        400,
        `Unsupported audio format "${record.mimetype}". Accepted: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm`,
      );
    }

    // Compress before creating any Drive/sheet state so a compression failure
    // leaves no orphan folder or row. The original file still goes to Drive as-is.
    const transcribable = await ensureTranscribable(record.buffer, record.originalname);

    const jobId = generateJobId();
    const folder = await createPatientFolder(fields.patientName, jobId);

    const [uploaded, transcript] = await Promise.all([
      uploadBinary(folder.fileId, record.originalname, record.buffer, record.mimetype),
      transcribe(transcribable.buffer, transcribable.filename),
    ]);

    await diagnosesRepo.appendDiagnosis({
      [DIAGNOSES_COLUMNS.TIMESTAMP]: new Date().toISOString(),
      [DIAGNOSES_COLUMNS.DIAGNOSIS_DATE]: fields.date,
      [DIAGNOSES_COLUMNS.PATIENT_NAME]: fields.patientName,
      [DIAGNOSES_COLUMNS.AGE]: fields.age,
      [DIAGNOSES_COLUMNS.SCHOOL]: fields.school,
      [DIAGNOSES_COLUMNS.GRADE]: fields.grade,
      [DIAGNOSES_COLUMNS.CITY]: fields.city,
      [DIAGNOSES_COLUMNS.RECORDING_FILE]: uploaded.link,
      [DIAGNOSES_COLUMNS.FOLDER]: folder.link,
      [DIAGNOSES_COLUMNS.JOB_ID]: jobId,
      [DIAGNOSES_COLUMNS.STATUS]: DiagnosisStatus.PROCESSING,
      [DIAGNOSES_COLUMNS.ID_NUMBER]: fields.id,
      [DIAGNOSES_COLUMNS.EMAIL]: fields.mail,
    });

    res.json({ jobid: jobId, status: DiagnosisStatus.PROCESSING });

    // Fire-and-forget: the pipeline handles its own errors internally (markJobFailed);
    // this .catch is just a last-resort safety net against an unhandled rejection.
    void runStep1Pipeline({
      jobId,
      folderId: folder.fileId,
      rawTranscript: transcript,
      patient: {
        name: fields.patientName,
        age: fields.age,
        school: fields.school,
        grade: fields.grade,
        city: fields.city,
        date: fields.date,
      },
    }).catch((err: unknown) => {
      logger.error({ jobId, err }, "step1 background pipeline rejected unexpectedly");
    });
  }),
);
