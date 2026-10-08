import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import {
  assertEnvSafety,
  buildEnvBootstrapSummary,
  formatEnvBootstrapLog,
  resolveAppEnv,
  type AppEnv,
} from "@forgeops/shared";
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
  APP_ENV: z
    .enum(["development", "production", "dev", "local", "prod"])
    .optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: optionalStringFromEnv,
  REDIS_URL: z.string().min(1),
  OPENAI_API_KEY: optionalStringFromEnv,
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  /** Semantic-signal extractor model (n8n Classify Email With Candidates parity). */
  OPENAI_SEMANTIC_MODEL: z.string().default("chat-latest"),
  /** Business subtype classifier model. */
  OPENAI_SUBTYPE_MODEL: z.string().default("chat-latest"),
  /** Entity selection model. */
  OPENAI_ENTITY_MODEL: z.string().default("chat-latest"),
  /** Task extraction model. */
  OPENAI_TASK_MODEL: z.string().default("chat-latest"),
  GOOGLE_CLIENT_ID: optionalStringFromEnv,
  GOOGLE_CLIENT_SECRET: optionalStringFromEnv,
  GOOGLE_REDIRECT_URI: optionalUrlFromEnv,
  GOOGLE_AUTH_REDIRECT_URI: optionalUrlFromEnv,
  GOOGLE_INBOX_REDIRECT_URI: optionalUrlFromEnv,
  OUTLOOK_CLIENT_ID: optionalStringFromEnv,
  OUTLOOK_CLIENT_SECRET: optionalStringFromEnv,
  OUTLOOK_REDIRECT_URI: optionalUrlFromEnv,
  OUTLOOK_TENANT_ID: z.string().default("common"),
  MICROSOFT_AUTH_CLIENT_ID: optionalStringFromEnv,
  MICROSOFT_AUTH_CLIENT_SECRET: optionalStringFromEnv,
  MICROSOFT_AUTH_REDIRECT_URI: optionalUrlFromEnv,
  GMAIL_PUBSUB_TOPIC: optionalStringFromEnv,
  PUSH_WEBHOOK_SECRET: optionalStringFromEnv,
  N8N_INTEGRATION_API_KEY: optionalStringFromEnv,
  N8N_INTEGRATION_ENABLED: booleanFromString.default("false"),
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
  DEV_ENABLE_BOOTSTRAP_ROUTES: booleanFromString.default("true"),
  ALLOW_REMOTE_INFRA: booleanFromString.default("false"),
  ALLOW_LOCAL_PROD_INFRA: booleanFromString.default("false"),
  /** Development-only: allow registering Graph push webhooks (normally blocked — localhost is unreachable). */
  ALLOW_DEV_GRAPH_WEBHOOKS: booleanFromString.default("false"),
  S3_BUCKET: optionalStringFromEnv,
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: optionalStringFromEnv,
  S3_SECRET_ACCESS_KEY: optionalStringFromEnv,
  S3_ENDPOINT: optionalStringFromEnv,
  ATTACHMENT_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024)
});

const parsedApiEnvSchema = apiEnvSchema.transform((env) => {
  const appEnv: AppEnv = resolveAppEnv({
    APP_ENV: env.APP_ENV,
    NODE_ENV: env.NODE_ENV,
  });
  const isProd = appEnv === "production";
  return {
    ...env,
    APP_ENV: appEnv,
    GOOGLE_AUTH_REDIRECT_URI:
      env.GOOGLE_AUTH_REDIRECT_URI ?? env.GOOGLE_REDIRECT_URI,
    GOOGLE_INBOX_REDIRECT_URI:
      env.GOOGLE_INBOX_REDIRECT_URI ?? env.GOOGLE_REDIRECT_URI,
    TOKEN_ENCRYPTION_SECRET:
      env.TOKEN_ENCRYPTION_SECRET ?? env.GOOGLE_TOKEN_ENCRYPTION_SECRET,
    INBOX_OAUTH_STATE_TTL_SECONDS:
      env.INBOX_OAUTH_STATE_TTL_SECONDS ?? env.GOOGLE_OAUTH_STATE_TTL_SECONDS,
    API_PORT: env.PORT ?? env.API_PORT,
    // Fail closed: bootstrap / auto-workspace never run in production app env.
    DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN: isProd
      ? false
      : env.DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN,
    DEV_ENABLE_BOOTSTRAP_ROUTES: isProd
      ? false
      : env.DEV_ENABLE_BOOTSTRAP_ROUTES,
  };
});

export type ApiEnv = z.infer<typeof parsedApiEnvSchema>;

export const loadApiEnv = (): ApiEnv => {
  const env = parsedApiEnvSchema.parse(process.env);
  assertEnvSafety({
    appEnv: env.APP_ENV,
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    directUrl: env.DIRECT_URL,
    redisUrl: env.REDIS_URL,
    frontendUrl: env.FRONTEND_URL,
    sessionCookieSecret: env.SESSION_COOKIE_SECRET,
    tokenEncryptionSecret: env.TOKEN_ENCRYPTION_SECRET,
    allowRemoteInfra: env.ALLOW_REMOTE_INFRA,
    allowLocalProdInfra: env.ALLOW_LOCAL_PROD_INFRA,
  });
  const summary = buildEnvBootstrapSummary({
    service: "api",
    appEnv: env.APP_ENV,
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    s3Bucket: env.S3_BUCKET ?? null,
    frontendUrl: env.FRONTEND_URL,
  });
  console.info(formatEnvBootstrapLog(summary));
  return env;
};
