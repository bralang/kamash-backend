import pino from "pino";
import { config } from "../config/env.js";

// pino-http logs request and response headers; the session cookie must never reach the logs.
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: ["req.headers.cookie", 'res.headers["set-cookie"]'],
});
