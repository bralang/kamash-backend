import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { logger } from "../lib/logger.js";
import { diagnosesRepo } from "../services/sheetsService.js";
import { getGeneralRules, getSectionInstructionsByTitle } from "../services/configRepo.js";
import { rewriteSnippet } from "../services/anthropicService.js";
import { DIAGNOSES_COLUMNS } from "../config/sheets.js";

/** Below this there is nothing to rephrase; above it the request is refused before
 * any model call. The client enforces the same ceiling so nothing is sent at all. */
const MIN_CONTENT_CHARS = 2;
const MAX_CONTENT_CHARS = 4000;

const bodySchema = z.object({
  jobId: z.string().min(1),
  /** What the editor captured, and therefore what it can insert back:
   *  "text" — plain text inside one block; "flow" — whole sibling blocks;
   *  "list" — whole <li> siblings. Drives both the prompt and the client's whitelist. */
  shape: z.enum(["text", "flow", "list"]),
  /** From the wrapping <section data-section="...">. Absent for documents that
   *  predate the sectioned layout, or when the selection sits outside any section. */
  sectionTitle: z.string().optional(),
  instruction: z.string().optional(),
  presetId: z.string().nullish(),
  content: z.string(),
  previous: z.string().optional(),
  attempt: z.number().int().positive().optional(),
});

/** Removes a wrapping markdown fence. The system prompt forbids it, but a fence is
 * a model formatting artifact rather than a policy question, so it is stripped here
 * too — the client's normalizer stays the authority on everything else. */
function stripCodeFence(value: string): string {
  const match = value.trim().match(/^```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/);
  return match ? match[1] : value;
}

export const rewriteTextRouter = Router();

rewriteTextRouter.post(
  "/rewritetext",
  asyncHandler(async (req, res) => {
    const body = bodySchema.parse(req.body);
    const content = body.content.trim();

    if (content.length < MIN_CONTENT_CHARS) {
      throw new HttpError(400, "Nothing to rewrite: content is empty", "EMPTY_INPUT");
    }
    if (content.length > MAX_CONTENT_CHARS) {
      throw new HttpError(
        400,
        `Snippet is too long to rewrite (${content.length} chars, max ${MAX_CONTENT_CHARS})`,
        "TOO_LONG",
      );
    }

    enforceRateLimit(body.jobId);

    // The row is both the access gate — this endpoint is otherwise unauthenticated
    // and CORS is open, so a valid jobId is what stops an anonymous caller from
    // spending Anthropic credits — and the source of the patient context below.
    const found = await diagnosesRepo.findByJobId(body.jobId);
    if (!found) {
      throw new HttpError(404, `No diagnosis found for jobId "${body.jobId}"`, "NOT_FOUND");
    }

    const [generalRules, sectionInstructions] = await Promise.all([
      getGeneralRules(),
      body.sectionTitle ? getSectionInstructionsByTitle(body.sectionTitle) : Promise.resolve(null),
    ]);
    if (body.sectionTitle && !sectionInstructions) {
      // Not fatal — the rewrite still runs on the general rules alone — but it means
      // the document's data-section no longer matches any שם הסעיף בעברית in the
      // config sheet, so every rewrite in that section is losing its editing rules.
      logger.warn(
        { jobId: body.jobId, sectionTitle: body.sectionTitle },
        "No section instructions matched the document's data-section title",
      );
    }

    const raw = await rewriteSnippet({
      shape: body.shape,
      content,
      instruction: body.instruction ?? "",
      previous: body.previous,
      generalRules,
      sectionInstructions: sectionInstructions?.editingInstructions,
      patient: {
        name: found.row[DIAGNOSES_COLUMNS.PATIENT_NAME] ?? "",
        age: found.row[DIAGNOSES_COLUMNS.AGE] ?? "",
        school: found.row[DIAGNOSES_COLUMNS.SCHOOL] ?? "",
        grade: found.row[DIAGNOSES_COLUMNS.GRADE] ?? "",
        city: found.row[DIAGNOSES_COLUMNS.CITY] ?? "",
      },
    });

    const result = stripCodeFence(raw).trim();
    if (!result) {
      throw new HttpError(502, "Anthropic snippet rewrite returned an empty result", "MODEL_ERROR");
    }

    // Nothing is written anywhere: the rewrite is a suggestion the diagnostician
    // approves in the editor, and the document is only persisted by editmanually.
    res.json({ result });
  }),
);
