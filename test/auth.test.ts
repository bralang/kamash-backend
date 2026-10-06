import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

vi.mock("../src/services/sheetsService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/sheetsService.js")>()),
  usersRepo: { findAll: vi.fn() },
}));

import { createApp } from "../src/app.js";
import { config } from "../src/config/env.js";
import { USERS_COLUMNS } from "../src/config/sheets.js";
import { usersRepo } from "../src/services/sheetsService.js";
import { clearUsersCache, issueSessionToken } from "../src/services/authService.js";
import { hashPassword } from "../src/lib/password.js";
import { resetRateLimits } from "../src/lib/rateLimit.js";
import { kamashRouter } from "../src/routes/index.js";
import { requireAuth, SESSION_COOKIE, CLIENT_HEADER } from "../src/middleware/requireAuth.js";

const app = createApp();
const BASE = "/webhook/kamash";
const PASSWORD = "correct horse battery";
let users: Record<string, string>[];

function userRow(email: string, fields: Partial<Record<keyof typeof USERS_COLUMNS, string>> = {}) {
  return {
    [USERS_COLUMNS.EMAIL]: email,
    [USERS_COLUMNS.NAME]: fields.NAME ?? "מאבחנת",
    [USERS_COLUMNS.PASSWORD_HASH]: fields.PASSWORD_HASH ?? "",
    [USERS_COLUMNS.ACTIVE]: fields.ACTIVE ?? "כן",
    [USERS_COLUMNS.SESSION_VERSION]: fields.SESSION_VERSION ?? "",
  };
}

function sessionCookieFrom(res: request.Response): string {
  const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error("no session cookie set");
  return cookie;
}

async function login(email = "Clinician@Example.com", password = PASSWORD) {
  return request(app).post(`${BASE}/auth/login`).set(CLIENT_HEADER, "web").send({ email, password });
}

/** Every [method, path] mounted after requireAuth, read from the router itself so a newly
 * added route is covered without editing this file. */
function protectedRoutes(): [string, string][] {
  const layers = (kamashRouter as unknown as { stack: any[] }).stack;
  const guardIndex = layers.findIndex((l) => l.handle === requireAuth);
  expect(guardIndex).toBeGreaterThan(-1);
  const routes: [string, string][] = [];
  for (const layer of layers.slice(guardIndex + 1)) {
    for (const inner of layer.handle.stack ?? []) {
      if (!inner.route) continue;
      for (const method of Object.keys(inner.route.methods)) routes.push([method, inner.route.path]);
    }
  }
  return routes;
}

beforeAll(async () => {
  const hash = await hashPassword(PASSWORD);
  users = [
    userRow("clinician@example.com", { PASSWORD_HASH: hash, SESSION_VERSION: "1" }),
    userRow("inactive@example.com", { PASSWORD_HASH: hash, ACTIVE: "לא" }),
  ];
  config.AUTH_ENFORCE = true;
});

afterAll(() => {
  config.AUTH_ENFORCE = false;
});

beforeEach(() => {
  clearUsersCache();
  resetRateLimits();
  vi.mocked(usersRepo.findAll).mockReset();
  vi.mocked(usersRepo.findAll).mockImplementation(async () => users);
});

describe("route protection", () => {
  it("guards every data route — none answers without a session", async () => {
    const routes = protectedRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const [method, path] of routes) {
      const res = await (request(app) as any)[method](`${BASE}${path}`).set(CLIENT_HEADER, "web");
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 401 });
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }
  });

  it("leaves the release stamp and logout public", async () => {
    expect((await request(app).get(`${BASE}/version`)).status).toBe(200);
    expect((await request(app).post(`${BASE}/auth/logout`)).status).toBe(200);
  });

  it("rejects a valid cookie that arrives without the client header", async () => {
    const cookie = sessionCookieFrom(await login());
    const res = await request(app).get(`${BASE}/auth/me`).set("Cookie", cookie);
    expect(res.status).toBe(401);
  });

  it("lets requests through, unauthenticated, while AUTH_ENFORCE is off", async () => {
    config.AUTH_ENFORCE = false;
    try {
      const res = await request(app).get(`${BASE}/auth/me`);
      // Passes the guard; auth/me itself still has no user to report.
      expect(res.status).toBe(401);
      const guarded = protectedRoutes()[0];
      const passed = await (request(app) as any)[guarded[0]](`${BASE}${guarded[1]}`);
      expect(passed.body.code).not.toBe("UNAUTHENTICATED");
    } finally {
      config.AUTH_ENFORCE = true;
    }
  });
});

describe("login", () => {
  it("signs in case-insensitively and sets a locked-down session cookie", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { email: "clinician@example.com", name: "מאבחנת" } });

    const cookie = sessionCookieFrom(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=None/i);
    expect(cookie).toMatch(/Path=\/webhook\/kamash/);

    const me = await request(app).get(`${BASE}/auth/me`).set("Cookie", cookie).set(CLIENT_HEADER, "web");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("clinician@example.com");
  });

  it("gives the same answer for a wrong password and an unknown address", async () => {
    const wrong = await login("clinician@example.com", "nope");
    const unknown = await login("nobody@example.com", PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses a user whose פעיל column is not כן", async () => {
    expect((await login("inactive@example.com")).status).toBe(401);
  });

  it("requires the client header, so another site cannot log a browser in", async () => {
    const res = await request(app)
      .post(`${BASE}/auth/login`)
      .send({ email: "clinician@example.com", password: PASSWORD });
    expect(res.status).toBe(400);
  });

  it("rate-limits guessing one account", async () => {
    for (let i = 0; i < 10; i++) expect((await login("clinician@example.com", "nope")).status).toBe(401);
    const res = await login();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  });

  it("logout clears the cookie", async () => {
    const res = await request(app).post(`${BASE}/auth/logout`);
    expect(sessionCookieFrom(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe("sessions", () => {
  async function me(token: string) {
    return request(app)
      .get(`${BASE}/auth/me`)
      .set("Cookie", `${SESSION_COOKIE}=${token}`)
      .set(CLIENT_HEADER, "web");
  }

  it("rejects a tampered token", async () => {
    const { token } = await issueSessionToken("clinician@example.com");
    const [data, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "inactive@example.com", ver: "", exp: Date.now() + 1e7 })).toString(
      "base64url",
    );
    expect((await me(`${forged}.${sig}`)).status).toBe(401);
    expect((await me(`${data}.${sig.slice(0, -2)}xx`)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const { token } = await issueSessionToken("clinician@example.com", Date.now() - 13 * 60 * 60 * 1000);
    expect((await me(token)).status).toBe(401);
  });

  it("signs a user out everywhere when גרסת התחברות changes", async () => {
    const { token } = await issueSessionToken("clinician@example.com");
    expect((await me(token)).status).toBe(200);

    users = [{ ...users[0], [USERS_COLUMNS.SESSION_VERSION]: "2" }, users[1]];
    clearUsersCache();
    expect((await me(token)).status).toBe(401);
    users = [{ ...users[0], [USERS_COLUMNS.SESSION_VERSION]: "1" }, users[1]];
  });

  it("renews the cookie once less than half the session is left, and not before", async () => {
    const fresh = await issueSessionToken("clinician@example.com");
    expect((await me(fresh.token)).headers["set-cookie"]).toBeUndefined();

    const old = await issueSessionToken("clinician@example.com", Date.now() - 7 * 60 * 60 * 1000);
    const res = await me(old.token);
    expect(res.status).toBe(200);
    expect(sessionCookieFrom(res)).toMatch(/Max-Age=43200/);
  });
});

describe("CORS", () => {
  it("allows credentials for the clinic's own origins only", async () => {
    const ok = await request(app)
      .options(`${BASE}/prevdiagnostics`)
      .set("Origin", "https://kamash.link-up.co.il")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", CLIENT_HEADER);
    expect(ok.headers["access-control-allow-origin"]).toBe("https://kamash.link-up.co.il");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");

    const evil = await request(app)
      .options(`${BASE}/prevdiagnostics`)
      .set("Origin", "https://link-up.co.il.evil.com")
      .set("Access-Control-Request-Method", "GET");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
