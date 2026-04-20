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

const optionalStringFromEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional()
);

const optionalUrlFromEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);

const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    OPENAI_API_KEY: optionalStringFromEnv,
    OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
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
      .default("development-token-encryption-secret")
  })
  .transform((env) => ({
    ...env,
    GOOGLE_INBOX_REDIRECT_URI:
      env.GOOGLE_INBOX_REDIRECT_URI ?? env.GOOGLE_REDIRECT_URI,
    TOKEN_ENCRYPTION_SECRET:
      env.TOKEN_ENCRYPTION_SECRET ?? env.GOOGLE_TOKEN_ENCRYPTION_SECRET
  }));

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const loadWorkerEnv = (): WorkerEnv =>
  workerEnvSchema.parse(process.env);
