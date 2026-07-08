import { Router } from "express";
import { editManuallyRouter } from "./editmanually.js";

export const kamashRouter = Router();

kamashRouter.use(editManuallyRouter);
