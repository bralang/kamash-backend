import { HttpError } from "./httpError.js";

/** Fixed-window counters held in process memory. Deliberately not Redis: this
 * process is the only one serving the API (`ecosystem.config.js` pins
 * `instances: 1, exec_mode: "fork"`), so a local Map is an accurate global view.
 * If this is ever moved to pm2 cluster mode the effective limits multiply by the
 * number of workers and this needs a shared store. */
const WINDOW_MS = 5 * 60 * 1000;

/** One diagnostician working on one document. Generous for real editing
 * (including repeated "another phrasing"), tight enough to bound the Anthropic
 * spend a single leaked jobId can cause. */
const PER_KEY_LIMIT = 30;

/** Process-wide cost circuit-breaker, independent of how many keys are in play. */
const GLOBAL_LIMIT = 200;

interface Counter {
  count: number;
  windowStart: number;
}

const perKey = new Map<string, Counter>();
let globalCounter: Counter = { count: 0, windowStart: 0 };

/** Returns true when the hit fits inside the counter's current window. */
function hit(counter: Counter, limit: number, now: number): boolean {
  if (now - counter.windowStart >= WINDOW_MS) {
    counter.windowStart = now;
    counter.count = 0;
  }
  counter.count += 1;
  return counter.count <= limit;
}

function prune(now: number): void {
  for (const [key, counter] of perKey) {
    if (now - counter.windowStart >= WINDOW_MS) perKey.delete(key);
  }
}

/**
 * Counts one request against both the per-key and the process-wide window.
 * Throws `HttpError(429, …, "RATE_LIMITED")` when either is exhausted.
 *
 * Keyed by jobId rather than IP on purpose: behind nginx every request arrives
 * from 127.0.0.1, so a real IP limit would need `app.set("trust proxy", 1)` — a
 * global change this endpoint does not need. jobId is also the more meaningful
 * unit here, since the route already requires it to match a real sheet row.
 */
export function enforceRateLimit(key: string): void {
  const now = Date.now();
  prune(now);

  let counter = perKey.get(key);
  if (!counter) {
    counter = { count: 0, windowStart: now };
    perKey.set(key, counter);
  }

  const keyOk = hit(counter, PER_KEY_LIMIT, now);
  const globalOk = hit(globalCounter, GLOBAL_LIMIT, now);
  if (keyOk && globalOk) return;

  throw new HttpError(
    429,
    keyOk
      ? `Global rewrite rate limit reached (${GLOBAL_LIMIT} per ${WINDOW_MS / 60000} minutes)`
      : `Rate limit reached for jobId "${key}" (${PER_KEY_LIMIT} per ${WINDOW_MS / 60000} minutes)`,
    "RATE_LIMITED",
  );
}

/** Test seam — clears every window so cases don't leak counts into each other. */
export function resetRateLimits(): void {
  perKey.clear();
  globalCounter = { count: 0, windowStart: 0 };
}
