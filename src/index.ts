import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { sweepStaleJobs } from "./services/pipeline/staleJobSweep.js";

const app = createApp();

app.listen(config.PORT, () => {
  logger.info(`kamash-backend listening on port ${config.PORT}`);
});

void sweepStaleJobs().catch((err: unknown) => {
  logger.error({ err }, "Stale job boot sweep failed");
});
