import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: z.string().min(1, "GOOGLE_SERVICE_ACCOUNT_KEY_PATH is required"),
  // Service accounts have zero Drive storage quota of their own, so Drive writes (folder/file
  // creation) fail with "Service Accounts do not have storage quota" unless the account
  // impersonates a real Workspace user via domain-wide delegation. This must be a real mailbox
  // in the link-up.co.il Workspace, authorized for this service account's Client ID in
  // admin.google.com > Security > API Controls > Domain-wide Delegation.
  GOOGLE_IMPERSONATED_USER_EMAIL: z.string().min(1, "GOOGLE_IMPERSONATED_USER_EMAIL is required"),

  // Not required yet — only needed once the step1/checkstatus/email endpoints are migrated.
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  // Sized for a full section rewrite and for a 4,000-char snippet rewrite, but only
  // while both Anthropic calls keep thinking disabled — thinking tokens are drawn
  // from this same budget. Raise it before enabling thinking anywhere.
  ANTHROPIC_MAX_TOKENS: z.coerce.number().default(4096),
  // Only read when ANTHROPIC_MODEL is claude-sonnet-5-5, where the section rewrite runs
  // with thinking on (see thinkingFor in anthropicService.ts). Thinking is drawn from
  // the call's max_tokens, so that call gets this larger budget instead.
  ANTHROPIC_THINKING_MAX_TOKENS: z.coerce.number().default(16000),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  GMAIL_OAUTH_REFRESH_TOKEN: z.string().optional(),

  // Signs the session cookie (HMAC-SHA256). Changing it logs every user out at once.
  // Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET is required and must be at least 32 characters"),
  // "false" only for the rollout window: requests without a valid session are logged
  // and let through instead of rejected. Not z.coerce.boolean — that reads "false" as true.
  AUTH_ENFORCE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Comma-separated origins allowed to call the API with credentials. Unset means any
  // https://*.link-up.co.il page plus the Vite dev server on localhost:8080.
  AUTH_ALLOWED_ORIGINS: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();
