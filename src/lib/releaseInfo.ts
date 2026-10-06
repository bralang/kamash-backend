import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What release is actually running, for the frontend's version stamp.
 *
 * The numbers come from `release.json`, which .github/workflows/deploy.yml writes
 * into the release package right before it is uploaded — so they describe the
 * deploy, not the machine. Nothing here is computed at runtime except
 * `startedAt`: a deploy that failed to restart the service would otherwise look
 * live, which is the one thing this endpoint exists to make visible.
 */
export interface ReleaseInfo {
  /** `<YYYYMMDDHHMMSS>-<sha7>`, the release directory's name on the server. */
  releaseId: string | null;
  commit: string | null;
  ref: string | null;
  /** When the deploy workflow built this release (ISO 8601, UTC). */
  deployedAt: string | null;
  /** When this process came up — a restart without a deploy moves only this. */
  startedAt: string;
}

const STAMP_FILE = "release.json";

function readStamp(): Partial<ReleaseInfo> {
  // dist/lib/releaseInfo.js (built) and src/lib/releaseInfo.ts (tsx) both sit two
  // levels below the package root, so this resolves the same either way — and
  // unlike process.cwd() it does not depend on how the service was started.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    return JSON.parse(readFileSync(path.join(root, STAMP_FILE), "utf8")) as Partial<ReleaseInfo>;
  } catch {
    // No stamp in a local checkout: report nulls rather than inventing a date.
    return {};
  }
}

const stamp = readStamp();

export const releaseInfo: ReleaseInfo = {
  releaseId: stamp.releaseId ?? null,
  commit: stamp.commit ?? null,
  ref: stamp.ref ?? null,
  deployedAt: stamp.deployedAt ?? null,
  startedAt: new Date().toISOString(),
};
