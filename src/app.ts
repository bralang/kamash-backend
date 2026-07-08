import express from "express";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { kamashRouter } from "./routes/index.js";
import { errorMiddleware } from "./middleware/errorMiddleware.js";

export function createApp() {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: "10mb" }));
  app.use("/kamash", kamashRouter);
  app.use(errorMiddleware);
  return app;
}
