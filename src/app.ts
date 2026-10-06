import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { kamashRouter } from "./routes/index.js";
import { errorMiddleware } from "./middleware/errorMiddleware.js";

const DEFAULT_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)*link-up\.co\.il$/, "http://localhost:8080"];

function allowedOrigins(): (string | RegExp)[] {
  const list = config.AUTH_ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean);
  return list && list.length > 0 ? list : DEFAULT_ORIGINS;
}

export function createApp() {
  const app = express();
  app.use(pinoHttp({ logger }));
  // Served from a separate host (kamash-api.link-up.co.il) than the frontend, so this is a
  // genuine cross-origin request. Since the login, CORS is no longer "*": the session cookie
  // only travels with credentialed requests, which a wildcard origin cannot allow, and
  // answering preflights only for our own origins is what makes the client-header CSRF
  // check in middleware/requireAuth.ts hold.
  app.use(cors({ origin: allowedOrigins(), credentials: true }));
  app.use(express.json({ limit: "10mb" }));
  // Path kept identical to the old n8n webhook path (/webhook/kamash/<name>) so cutting
  // over to kamash-api.link-up.co.il is purely a hostname swap in the frontend.
  app.use("/webhook/kamash", kamashRouter);
  app.use(errorMiddleware);
  return app;
}
