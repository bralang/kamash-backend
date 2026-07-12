import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { kamashRouter } from "./routes/index.js";
import { errorMiddleware } from "./middleware/errorMiddleware.js";

export function createApp() {
  const app = express();
  app.use(pinoHttp({ logger }));
  // Served from a separate domain (kamash-api.link-up.co.il) than the frontend, so this is
  // a genuine cross-origin request. Wide open here to match the n8n webhook nodes' own
  // "allowedOrigins": "*" setting — not a new, looser policy introduced by this port.
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  // Path kept identical to the old n8n webhook path (/webhook/kamash/<name>) so cutting
  // over to kamash-api.link-up.co.il is purely a hostname swap in the frontend.
  app.use("/webhook/kamash", kamashRouter);
  app.use(errorMiddleware);
  return app;
}
