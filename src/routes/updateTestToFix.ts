import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { parentQuestionnairesRepo } from "../services/sheetsService.js";
import { PARENT_QUESTIONNAIRES_COLUMNS, ParentQuestionnaireStatus } from "../config/sheets.js";

// `date` and `mail` are sent by the frontend but unused here — the original n8n
// workflow never wrote them to "שאלוני הורים" either, so they're accepted (and ignored)
// for contract parity rather than rejected.
const bodySchema = z.object({
  patientName: z.string().min(1),
  idNumber: z.string().default(""),
  age: z.string().default(""),
  school: z.string().default(""),
  grade: z.string().default(""),
  city: z.string().default(""),
  date: z.string().optional(),
  mail: z.string().optional(),
  healthFund: z.string().default(""),
});

export const updateTestToFixRouter = Router();

updateTestToFixRouter.post(
  "/updateTestToFix",
  asyncHandler(async (req, res) => {
    const { patientName, idNumber, age, school, grade, city, healthFund } = bodySchema.parse(req.body);

    const found = await parentQuestionnairesRepo.findByName(patientName);
    if (!found) {
      throw new HttpError(404, `No pending questionnaire found for patient "${patientName}"`);
    }

    await parentQuestionnairesRepo.updateByRowNumber(found.rowNumber, {
      [PARENT_QUESTIONNAIRES_COLUMNS.NAME]: patientName,
      [PARENT_QUESTIONNAIRES_COLUMNS.ID_NUMBER]: idNumber,
      [PARENT_QUESTIONNAIRES_COLUMNS.AGE]: age,
      [PARENT_QUESTIONNAIRES_COLUMNS.GRADE]: grade,
      [PARENT_QUESTIONNAIRES_COLUMNS.SCHOOL]: school,
      [PARENT_QUESTIONNAIRES_COLUMNS.CITY]: city,
      [PARENT_QUESTIONNAIRES_COLUMNS.STATUS]: ParentQuestionnaireStatus.COMPLETED,
      // Only when chosen: the form pre-fills just the values in its closed list, so an
      // empty one may mean "the sheet holds something else", not "clear it".
      ...(healthFund ? { [PARENT_QUESTIONNAIRES_COLUMNS.HEALTH_FUND]: healthFund } : {}),
    });

    res.json({ status: "ok" });
  }),
);
