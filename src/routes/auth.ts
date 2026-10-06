import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../lib/httpError.js";
import { enforceLoginRateLimit } from "../lib/rateLimit.js";
import { logger } from "../lib/logger.js";
import { authenticate, normalizeEmail } from "../services/authService.js";
import {
  clearSessionCookie,
  currentUser,
  hasClientHeader,
  requireAuth,
  setSessionCookie,
} from "../middleware/requireAuth.js";

export const authRouter = Router();

const loginBodySchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Public. One message for every failure, so the response never tells an unknown address
 * from a wrong password. The client header is required here too, which stops another
 * site from logging a browser into an account of its choosing.
 */
authRouter.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    if (!hasClientHeader(req)) throw new HttpError(400, "Missing client header");
    const body = loginBodySchema.parse(req.body);
    const email = normalizeEmail(body.email);
    enforceLoginRateLimit(email);

    const user = await authenticate(email, body.password);
    if (!user) {
      logger.warn({ email }, "Failed login");
      throw new HttpError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    await setSessionCookie(res, user.email);
    logger.info({ email: user.email }, "Login");
    res.json({ user });
  }),
);

/** Public: clearing a cookie needs no proof of who you are. */
authRouter.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ status: "ok" });
});

/** The frontend's route guard asks this before rendering any page behind the login. */
authRouter.get("/auth/me", requireAuth, (_req, res) => {
  const user = currentUser(res);
  if (!user) throw new HttpError(401, "Authentication required", "UNAUTHENTICATED");
  res.set("Cache-Control", "no-store");
  res.json({ user });
});
