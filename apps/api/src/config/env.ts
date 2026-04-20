import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { z } from "zod";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, "..", "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const rootEnvPath = path.resolve(repoRoot, ".env");
const appEnvPath = path.resolve(appRoot, ".env");

config({ path: rootEnvPath });
config({ path: appEnvPath, override: true });

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const optionalStringFromEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional()
);

const optionalUrlFromEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  OPENAI_API_KEY: optionalStringFromEnv,
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  GOOGLE_CLIENT_ID: optionalStringFromEnv,
  GOOGLE_CLIENT_SECRET: optionalStringFromEnv,
  GOOGLE_REDIRECT_URI: optionalUrlFromEnv,
  GOOGLE_AUTH_REDIRECT_URI: optionalUrlFromEnv,
  GOOGLE_INBOX_REDIRECT_URI: optionalUrlFromEnv,
  OUTLOOK_CLIENT_ID: optionalStringFromEnv,
  OUTLOOK_CLIENT_SECRET: optionalStringFromEnv,
  OUTLOOK_REDIRECT_URI: optionalUrlFromEnv,
  OUTLOOK_TENANT_ID: z.string().default("common"),
  SESSION_COOKIE_NAME: z.string().default("forgeops_session"),
  SESSION_COOKIE_SECRET: z
    .string()
    .min(16)
    .default("development-session-secret-change-me"),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  INBOX_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  GOOGLE_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  TOKEN_ENCRYPTION_SECRET: optionalStringFromEnv,
  GOOGLE_TOKEN_ENCRYPTION_SECRET: z
    .string()
    .min(32)
    .default("development-token-encryption-secret"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN: booleanFromString.default("true"),
  DEV_ENABLE_BOOTSTRAP_ROUTES: booleanFromString.default("true")
});

const parsedApiEnvSchema = apiEnvSchema.transform((env) => ({
  ...env,
  GOOGLE_AUTH_REDIRECT_URI:
    env.GOOGLE_AUTH_REDIRECT_URI ?? env.GOOGLE_REDIRECT_URI,
  GOOGLE_INBOX_REDIRECT_URI:
    env.GOOGLE_INBOX_REDIRECT_URI ?? env.GOOGLE_REDIRECT_URI,
  TOKEN_ENCRYPTION_SECRET:
    env.TOKEN_ENCRYPTION_SECRET ?? env.GOOGLE_TOKEN_ENCRYPTION_SECRET,
  INBOX_OAUTH_STATE_TTL_SECONDS:
    env.INBOX_OAUTH_STATE_TTL_SECONDS ?? env.GOOGLE_OAUTH_STATE_TTL_SECONDS,
  API_PORT: env.PORT ?? env.API_PORT
}));

export type ApiEnv = z.infer<typeof parsedApiEnvSchema>;

export const loadApiEnv = (): ApiEnv => parsedApiEnvSchema.parse(process.env);
