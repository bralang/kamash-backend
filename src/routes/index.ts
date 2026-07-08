import { Router } from "express";
import { editManuallyRouter } from "./editmanually.js";
import { updateTestToFixRouter } from "./updateTestToFix.js";
import { pendingDiagnosticsRouter } from "./pendingDiagnostics.js";
import { prevDiagnosticsRouter } from "./prevDiagnostics.js";
import { sendEmailRouter } from "./sendEmail.js";
import { step1Router } from "./step1.js";
import { checkstatusRouter } from "./checkstatus.js";

export const kamashRouter = Router();

kamashRouter.use(editManuallyRouter);
kamashRouter.use(updateTestToFixRouter);
kamashRouter.use(pendingDiagnosticsRouter);
kamashRouter.use(prevDiagnosticsRouter);
kamashRouter.use(sendEmailRouter);
kamashRouter.use(step1Router);
kamashRouter.use(checkstatusRouter);
