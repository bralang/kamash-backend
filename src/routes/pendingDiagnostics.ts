import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { parentQuestionnairesRepo } from "../services/sheetsService.js";

export const pendingDiagnosticsRouter = Router();

pendingDiagnosticsRouter.get(
  "/pendingdiagnostics",
  asyncHandler(async (_req, res) => {
    const rows = await parentQuestionnairesRepo.findPending();
    res.json(rows);
  }),
);
