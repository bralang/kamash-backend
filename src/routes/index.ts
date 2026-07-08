import { Router } from "express";
import { editManuallyRouter } from "./editmanually.js";
import { updateTestToFixRouter } from "./updateTestToFix.js";

export const kamashRouter = Router();

kamashRouter.use(editManuallyRouter);
kamashRouter.use(updateTestToFixRouter);
