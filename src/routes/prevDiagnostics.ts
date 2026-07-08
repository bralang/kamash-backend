import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { diagnosesRepo } from "../services/sheetsService.js";

export const prevDiagnosticsRouter = Router();

prevDiagnosticsRouter.get(
  "/prevdiagnostics",
  asyncHandler(async (_req, res) => {
    const rows = await diagnosesRepo.findAll();
    res.json(rows);
  }),
);
