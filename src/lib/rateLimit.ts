import { HttpError } from "./httpError.js";

/** Fixed-window counters held in process memory. Deliberately not Redis: this
 * process is the only one serving the API (`ecosystem.config.js` pins
 * `instances: 1, exec_mode: "fork"`), so a local Map is an accurate global view.
 * If this is ever moved to pm2 cluster mode the effective limits multiply by the
 * number of workers and this needs a shared store. */
const WINDOW_MS = 5 * 60 * 1000;
const WINDOW_MINUTES = WINDOW_MS / 60000;

interface Counter {
  count: number;
  windowStart: number;
}

/** Returns true when the hit fits inside the counter's current window. */
function hit(counter: Counter, limit: number, now: number): boolean {
  if (now - counter.windowStart >= WINDOW_MS) {
    counter.windowStart = now;
    counter.count = 0;
  }
  counter.count += 1;
  return counter.count <= limit;
}

interface LimiterOptions {
  perKeyLimit: number;
  /** Process-wide cost circuit-breaker, independent of how many keys are in play. */
  globalLimit: number;
  globalMessage: string;
  keyMessage: (key: string) => string;
}

interface RateLimiter {
  enforce(key: string): void;
  reset(): void;
}

/** Each limiter keeps its own windows, so login attempts never eat into the rewrite budget. */
function createRateLimiter(options: LimiterOptions): RateLimiter {
  const perKey = new Map<string, Counter>();
  let globalCounter: Counter = { count: 0, windowStart: 0 };

  function prune(now: number): void {
    for (const [key, counter] of perKey) {
      if (now - counter.windowStart >= WINDOW_MS) perKey.delete(key);
    }
  }

  return {
    enforce(key: string): void {
      const now = Date.now();
      prune(now);

      let counter = perKey.get(key);
      if (!counter) {
        counter = { count: 0, windowStart: now };
        perKey.set(key, counter);
      }

      const keyOk = hit(counter, options.perKeyLimit, now);
      const globalOk = hit(globalCounter, options.globalLimit, now);
      if (keyOk && globalOk) return;

      throw new HttpError(429, keyOk ? options.globalMessage : options.keyMessage(key), "RATE_LIMITED");
    },
    reset(): void {
      perKey.clear();
      globalCounter = { count: 0, windowStart: 0 };
    },
  };
}

/** One diagnostician working on one document. Generous for real editing
 * (including repeated "another phrasing"), tight enough to bound the Anthropic
 * spend a single leaked jobId can cause. */
const rewriteLimiter = createRateLimiter({
  perKeyLimit: 30,
  globalLimit: 200,
  globalMessage: `Global rewrite rate limit reached (200 per ${WINDOW_MINUTES} minutes)`,
  keyMessage: (key) => `Rate limit reached for jobId "${key}" (30 per ${WINDOW_MINUTES} minutes)`,
});

/** Bounds password guessing: the per-email cap protects one clinician's account,
 * the global cap a spray across many addresses. */
const loginLimiter = createRateLimiter({
  perKeyLimit: 10,
  globalLimit: 100,
  globalMessage: `Too many login attempts (100 per ${WINDOW_MINUTES} minutes)`,
  keyMessage: () => `Too many login attempts for this user (10 per ${WINDOW_MINUTES} minutes)`,
});

/**
 * Throws `HttpError(429, …, "RATE_LIMITED")` when either window is exhausted.
 *
 * Keyed by jobId rather than IP on purpose: behind nginx every request arrives
 * from 127.0.0.1, so a real IP limit would need `app.set("trust proxy", 1)` — a
 * global change this endpoint does not need. jobId is also the more meaningful
 * unit here, since the route already requires it to match a real sheet row.
 */
export function enforceRateLimit(key: string): void {
  rewriteLimiter.enforce(key);
}

/** Keyed by the normalized email being tried, for the same nginx reason as above. */
export function enforceLoginRateLimit(email: string): void {
  loginLimiter.enforce(email);
}

/** Test seam — clears every window so cases don't leak counts into each other. */
export function resetRateLimits(): void {
  rewriteLimiter.reset();
  loginLimiter.reset();
}
