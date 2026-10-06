import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config/env.js";
import { USERS_COLUMNS } from "../config/sheets.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { usersRepo } from "./sheetsService.js";

/**
 * Login for the clinic's diagnosticians. Users live in the "משתמשים" sheet; a session is
 * a stateless HMAC-signed token in an HttpOnly cookie (see middleware/requireAuth.ts).
 * There is one permission level: signed in or not.
 */

export interface AuthUser {
  email: string;
  name: string;
}

interface StoredUser extends AuthUser {
  passwordHash: string;
  active: boolean;
  sessionVersion: string;
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Hashed against when the email is unknown, so a wrong address costs the same time as a
 * wrong password and response timing does not reveal which addresses exist. */
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

// ---- Users ----

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The sheet is read on every authenticated request, so it is cached briefly. Removing a
 * user, unticking "פעיל" or bumping "גרסת התחברות" therefore takes effect within this window. */
const USERS_CACHE_MS = 60 * 1000;
let usersCache: { at: number; users: Map<string, StoredUser> } | null = null;

async function loadUsers(): Promise<Map<string, StoredUser>> {
  const now = Date.now();
  if (usersCache && now - usersCache.at < USERS_CACHE_MS) return usersCache.users;

  const rows = await usersRepo.findAll();
  const users = new Map<string, StoredUser>();
  for (const row of rows) {
    const email = normalizeEmail(row[USERS_COLUMNS.EMAIL] ?? "");
    if (!email) continue;
    users.set(email, {
      email,
      name: (row[USERS_COLUMNS.NAME] ?? "").trim(),
      passwordHash: row[USERS_COLUMNS.PASSWORD_HASH] ?? "",
      active: (row[USERS_COLUMNS.ACTIVE] ?? "").trim() === "כן",
      sessionVersion: (row[USERS_COLUMNS.SESSION_VERSION] ?? "").trim(),
    });
  }
  usersCache = { at: now, users };
  return users;
}

/** Test seam. */
export function clearUsersCache(): void {
  usersCache = null;
}

/** Returns the user only when the email exists, is active, and the password matches. */
export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const user = (await loadUsers()).get(normalizeEmail(email));
  if (!user || !user.active || !user.passwordHash) {
    await verifyPassword(password, await DUMMY_HASH);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  return { email: user.email, name: user.name };
}

// ---- Session tokens ----

interface SessionPayload {
  sub: string;
  ver: string;
  exp: number;
}

function sign(data: string): string {
  return createHmac("sha256", config.AUTH_SECRET).update(data).digest("base64url");
}

export async function issueSessionToken(email: string, now = Date.now()): Promise<{ token: string; expiresAt: number }> {
  const user = (await loadUsers()).get(normalizeEmail(email));
  const payload: SessionPayload = { sub: normalizeEmail(email), ver: user?.sessionVersion ?? "", exp: now + SESSION_TTL_MS };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${data}.${sign(data)}`, expiresAt: payload.exp };
}

/** Checks signature and expiry, then that the user is still in the sheet, still active,
 * and still on the session version the token was issued for. */
export async function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
): Promise<{ user: AuthUser; expiresAt: number } | null> {
  if (!token) return null;
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(data));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.sub !== "string" || typeof payload.exp !== "number" || payload.exp <= now) return null;

  const user = (await loadUsers()).get(payload.sub);
  if (!user || !user.active || user.sessionVersion !== payload.ver) return null;
  return { user: { email: user.email, name: user.name }, expiresAt: payload.exp };
}
