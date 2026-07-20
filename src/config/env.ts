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
  ANTHROPIC_MAX_TOKENS: z.coerce.number().default(4096),
  GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  GMAIL_OAUTH_REFRESH_TOKEN: z.string().optional(),
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
