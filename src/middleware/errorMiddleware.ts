import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/httpError.js";
import { logger } from "../lib/logger.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request body", issues: err.issues });
    return;
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error({ err, path: req.path }, "Unhandled error");
  res.status(500).json({ error: message });
}
