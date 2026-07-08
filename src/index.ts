import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";

const app = createApp();

app.listen(config.PORT, () => {
  logger.info(`kamash-backend listening on port ${config.PORT}`);
});
