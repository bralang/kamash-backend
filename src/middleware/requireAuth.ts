import type { NextFunction, Request, Response } from "express";
import { config } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";
import { logger } from "../lib/logger.js";
import { issueSessionToken, SESSION_TTL_MS, verifySessionToken, type AuthUser } from "../services/authService.js";

export const SESSION_COOKIE = "kamash_session";

/**
 * Every request the frontend makes carries this header (src/lib/api.ts there). A custom
 * header cannot be sent cross-origin without a CORS preflight, and app.ts only answers
 * preflights from allowed origins — so a form or <img> on another site, which the browser
 * would happily send with our SameSite=None cookie attached, never gets past this check.
 */
export const CLIENT_HEADER = "x-kamash-client";

/**
 * SameSite=None rather than Lax: the frontend in production is a sibling subdomain (same
 * site, Lax would do), but local development runs on http://localhost:8080 against this
 * same API, which is cross-site. CSRF is covered by CLIENT_HEADER instead.
 * Path-scoped so the cookie is not sent to anything else on this host.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/webhook/kamash",
  };
}

export async function setSessionCookie(res: Response, email: string): Promise<void> {
  const { token } = await issueSessionToken(email);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function hasClientHeader(req: Request): boolean {
  return Boolean(req.get(CLIENT_HEADER));
}

/** The signed-in user, set by requireAuth. Undefined only in AUTH_ENFORCE=false mode. */
export function currentUser(res: Response): AuthUser | undefined {
  return res.locals.user as AuthUser | undefined;
}

/**
 * Mounted in routes/index.ts ahead of every router except the few public ones, so a new
 * route is protected without having to remember to ask for it.
 *
 * The session slides: once less than half its lifetime is left, a fresh cookie is issued,
 * so a clinician working through the day is not logged out mid-document.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = hasClientHeader(req) ? await verifySessionToken(readCookie(req, SESSION_COOKIE)) : null;

    if (session) {
      res.locals.user = session.user;
      if (session.expiresAt - Date.now() < SESSION_TTL_MS / 2) {
        await setSessionCookie(res, session.user.email);
      }
      next();
      return;
    }

    if (!config.AUTH_ENFORCE) {
      logger.warn(
        { path: req.path, method: req.method, hasClientHeader: hasClientHeader(req) },
        "Unauthenticated request let through (AUTH_ENFORCE=false)",
      );
      next();
      return;
    }

    next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
  } catch (err) {
    next(err);
  }
}
