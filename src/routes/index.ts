import { Router } from "express";
import { editManuallyRouter } from "./editmanually.js";
import { updateTestToFixRouter } from "./updateTestToFix.js";
import { updateMailRouter } from "./updatemail.js";
import { deleteDiagnosisRouter } from "./deletediagnosis.js";
import { pendingDiagnosticsRouter } from "./pendingDiagnostics.js";
import { prevDiagnosticsRouter } from "./prevDiagnostics.js";
import { sendEmailRouter } from "./sendEmail.js";
import { step1Router } from "./step1.js";
import { checkstatusRouter } from "./checkstatus.js";
import { rewriteTextRouter } from "./rewritetext.js";

export const kamashRouter = Router();

kamashRouter.use(editManuallyRouter);
kamashRouter.use(updateTestToFixRouter);
kamashRouter.use(updateMailRouter);
kamashRouter.use(deleteDiagnosisRouter);
kamashRouter.use(pendingDiagnosticsRouter);
kamashRouter.use(prevDiagnosticsRouter);
kamashRouter.use(sendEmailRouter);
kamashRouter.use(step1Router);
kamashRouter.use(checkstatusRouter);
kamashRouter.use(rewriteTextRouter);
