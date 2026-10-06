import { Router } from "express";
import { authRouter } from "./auth.js";
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
import { versionRouter } from "./version.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const kamashRouter = Router();

// Public: login/logout (auth/me guards itself) and the release stamp.
kamashRouter.use(authRouter);
kamashRouter.use(versionRouter);

// Everything mounted below this line requires a signed-in user. Add new routers here,
// not above — test/auth.test.ts fails for any route that answers without a session.
kamashRouter.use(requireAuth);

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
