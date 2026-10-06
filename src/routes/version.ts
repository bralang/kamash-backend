import { Router } from "express";
import { releaseInfo } from "../lib/releaseInfo.js";

export const versionRouter = Router();

/**
 * Read by the frontend's footer stamp (src/components/VersionStamp.tsx there), and
 * useful on its own in a browser to answer "did my deploy actually land?".
 *
 * GET, unauthenticated and CORS-open like every other route here; it exposes a
 * commit sha and two timestamps, nothing about the data. `no-store` matters:
 * a proxy caching this would report an old release after a deploy, which is
 * exactly the question it is asked.
 */
versionRouter.get("/version", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(releaseInfo);
});
