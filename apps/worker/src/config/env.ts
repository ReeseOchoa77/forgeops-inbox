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

const optionalStringFromEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional()
);

const optionalUrlFromEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const workerEnvSchema = z
  .object({
    APP_ENV: z
      .enum(["development", "production", "dev", "local", "prod"])
      .optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    DIRECT_URL: optionalStringFromEnv,
    REDIS_URL: z.string().min(1),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    OPENAI_API_KEY: optionalStringFromEnv,
    OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
    OPENAI_SEMANTIC_MODEL: z.string().default("chat-latest"),
    OPENAI_SUBTYPE_MODEL: z.string().default("chat-latest"),
    OPENAI_ENTITY_MODEL: z.string().default("chat-latest"),
    OPENAI_TASK_MODEL: z.string().default("chat-latest"),
    OPENAI_IMAGE_RELEVANCE_MODEL: z.string().default("gpt-4o-mini"),
    GOOGLE_CLIENT_ID: optionalStringFromEnv,
    GOOGLE_CLIENT_SECRET: optionalStringFromEnv,
    GOOGLE_REDIRECT_URI: optionalUrlFromEnv,
    GOOGLE_INBOX_REDIRECT_URI: optionalUrlFromEnv,
    OUTLOOK_CLIENT_ID: optionalStringFromEnv,
    OUTLOOK_CLIENT_SECRET: optionalStringFromEnv,
    OUTLOOK_TENANT_ID: z.string().default("common"),
    TOKEN_ENCRYPTION_SECRET: optionalStringFromEnv,
    GOOGLE_TOKEN_ENCRYPTION_SECRET: z
      .string()
      .min(32)
      .default("development-token-encryption-secret"),
    ALLOW_REMOTE_INFRA: booleanFromString.default("false"),
    ALLOW_LOCAL_PROD_INFRA: booleanFromString.default("false"),
    S3_BUCKET: optionalStringFromEnv,
    S3_REGION: z.string().default("us-east-1"),
    S3_ACCESS_KEY_ID: optionalStringFromEnv,
    S3_SECRET_ACCESS_KEY: optionalStringFromEnv,
    S3_ENDPOINT: optionalStringFromEnv,
    ATTACHMENT_MAX_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25 * 1024 * 1024),
  })
  .transform((env) => {
    const appEnv: AppEnv = resolveAppEnv({
      APP_ENV: env.APP_ENV,
      NODE_ENV: env.NODE_ENV,
    });
    return {
      ...env,
      APP_ENV: appEnv,
      GOOGLE_INBOX_REDIRECT_URI:
        env.GOOGLE_INBOX_REDIRECT_URI ?? env.GOOGLE_REDIRECT_URI,
      TOKEN_ENCRYPTION_SECRET:
        env.TOKEN_ENCRYPTION_SECRET ?? env.GOOGLE_TOKEN_ENCRYPTION_SECRET,
    };
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const loadWorkerEnv = (): WorkerEnv => {
  const env = workerEnvSchema.parse(process.env);
  assertEnvSafety({
    appEnv: env.APP_ENV,
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    directUrl: env.DIRECT_URL,
    redisUrl: env.REDIS_URL,
    tokenEncryptionSecret: env.TOKEN_ENCRYPTION_SECRET,
    allowRemoteInfra: env.ALLOW_REMOTE_INFRA,
    allowLocalProdInfra: env.ALLOW_LOCAL_PROD_INFRA,
  });
  const summary = buildEnvBootstrapSummary({
    service: "worker",
    appEnv: env.APP_ENV,
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    s3Bucket: env.S3_BUCKET ?? null,
  });
  console.info(formatEnvBootstrapLog(summary));
  return env;
};
