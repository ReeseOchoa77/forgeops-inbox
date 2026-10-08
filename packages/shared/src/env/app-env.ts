/**
 * ForgeOps application environment (distinct from NODE_ENV).
 *
 * NODE_ENV is overloaded by build tooling (Vite/tsc often set "production"
 * for optimized builds). APP_ENV is the operational environment:
 *   - development → localhost / local docker-compose
 *   - production  → customer-facing Railway + Vercel
 *
 * Core rule: implementation complete ≠ production deployed.
 */

export const APP_ENVS = ["development", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "host.docker.internal",
]);

/** Resolve APP_ENV from process env with safe defaults. */
export function resolveAppEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const raw = (env.APP_ENV ?? "").trim().toLowerCase();
  if (raw === "development" || raw === "dev" || raw === "local") {
    return "development";
  }
  if (raw === "production" || raw === "prod") {
    return "production";
  }
  // Default from NODE_ENV when APP_ENV unset.
  if (env.NODE_ENV === "production") return "production";
  return "development";
}

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return true;
  // Private LAN ranges commonly used for local docker / LAN DB.
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

export function hostnameFromUrl(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  try {
    // redis:// and postgresql:// are valid URL schemes for WHATWG URL.
    const u = new URL(raw.trim());
    return u.hostname || null;
  } catch {
    return null;
  }
}

export type InfraUrlKind = "DATABASE_URL" | "REDIS_URL" | "DIRECT_URL";

export type EnvSafetyIssue = {
  code: string;
  message: string;
};

/**
 * Fail-closed checks that make accidental cross-environment access harder.
 *
 * Escape hatches (explicit only):
 * - ALLOW_REMOTE_INFRA=true  — development may use remote DB/Redis
 * - ALLOW_LOCAL_PROD_INFRA=true — production may use localhost (rare/local smoke)
 */
export function collectEnvSafetyIssues(input: {
  appEnv: AppEnv;
  nodeEnv?: string | undefined;
  databaseUrl?: string | undefined;
  directUrl?: string | undefined;
  redisUrl?: string | undefined;
  frontendUrl?: string | undefined;
  sessionCookieSecret?: string | undefined;
  tokenEncryptionSecret?: string | undefined;
  allowRemoteInfra?: boolean;
  allowLocalProdInfra?: boolean;
}): EnvSafetyIssue[] {
  const issues: EnvSafetyIssue[] = [];
  const allowRemote = input.allowRemoteInfra === true;
  const allowLocalProd = input.allowLocalProdInfra === true;

  if (
    input.appEnv === "development" &&
    input.nodeEnv === "production"
  ) {
    issues.push({
      code: "APP_ENV_NODE_ENV_MISMATCH",
      message:
        "APP_ENV=development but NODE_ENV=production. Set APP_ENV=production for live deploys, or NODE_ENV=development for local work.",
    });
  }

  const checkLocalOnly = (kind: InfraUrlKind, url: string | undefined) => {
    if (!url?.trim()) return;
    const host = hostnameFromUrl(url);
    if (!host) {
      issues.push({
        code: `${kind}_UNPARSEABLE`,
        message: `${kind} could not be parsed. Refusing to start.`,
      });
      return;
    }
    const local = isLocalHostname(host);
    if (input.appEnv === "development" && !local && !allowRemote) {
      issues.push({
        code: `${kind}_REMOTE_IN_DEVELOPMENT`,
        message:
          `${kind} points at remote host "${host}" while APP_ENV=development. ` +
          `Local development must use docker-compose / localhost. ` +
          `Set ALLOW_REMOTE_INFRA=true only if you intentionally accept writing to that remote.`,
      });
    }
    if (input.appEnv === "production" && local && !allowLocalProd) {
      issues.push({
        code: `${kind}_LOCAL_IN_PRODUCTION`,
        message:
          `${kind} points at local host "${host}" while APP_ENV=production. ` +
          `Production must use the production database/Redis. ` +
          `Set ALLOW_LOCAL_PROD_INFRA=true only for deliberate local production-mode smoke tests.`,
      });
    }
  };

  checkLocalOnly("DATABASE_URL", input.databaseUrl);
  checkLocalOnly("DIRECT_URL", input.directUrl);
  checkLocalOnly("REDIS_URL", input.redisUrl);

  if (input.appEnv === "production") {
    const weakSession =
      !input.sessionCookieSecret ||
      input.sessionCookieSecret === "development-session-secret-change-me" ||
      input.sessionCookieSecret.length < 32;
    if (weakSession) {
      issues.push({
        code: "WEAK_SESSION_SECRET",
        message:
          "APP_ENV=production requires a strong SESSION_COOKIE_SECRET (≥32 chars, not the development default).",
      });
    }
    const weakToken =
      !input.tokenEncryptionSecret ||
      input.tokenEncryptionSecret === "development-token-encryption-secret" ||
      input.tokenEncryptionSecret.length < 32;
    if (weakToken) {
      issues.push({
        code: "WEAK_TOKEN_ENCRYPTION_SECRET",
        message:
          "APP_ENV=production requires a strong TOKEN_ENCRYPTION_SECRET / GOOGLE_TOKEN_ENCRYPTION_SECRET (≥32 chars, not the development default).",
      });
    }
    if (input.frontendUrl) {
      try {
        const frontHost = new URL(input.frontendUrl).hostname;
        if (isLocalHostname(frontHost)) {
          issues.push({
            code: "FRONTEND_URL_LOCAL_IN_PRODUCTION",
            message:
              `FRONTEND_URL is local (${input.frontendUrl}) while APP_ENV=production. ` +
              `Set FRONTEND_URL to the production web origin (CORS + OAuth return).`,
          });
        }
      } catch {
        issues.push({
          code: "FRONTEND_URL_INVALID",
          message: `FRONTEND_URL is invalid: ${input.frontendUrl}`,
        });
      }
    }
  }

  return issues;
}

/** Throw a single Error listing all safety issues (fail-closed boot). */
export function assertEnvSafety(input: Parameters<typeof collectEnvSafetyIssues>[0]): void {
  const issues = collectEnvSafetyIssues(input);
  if (issues.length === 0) return;
  const body = issues.map((i) => `  [${i.code}] ${i.message}`).join("\n");
  throw new Error(
    `ForgeOps environment safety check failed (${issues.length}):\n${body}\n` +
      `See docs/DEPLOYMENT.md. Implementation complete ≠ production deployed.`
  );
}

/** True when prisma migrate deploy is allowed for this process env. */
export function canRunProductionMigrateDeploy(
  env: NodeJS.ProcessEnv = process.env
): { ok: true } | { ok: false; reason: string } {
  const appEnv = resolveAppEnv(env);
  if (env.ALLOW_PRODUCTION_MIGRATE === "true") {
    return { ok: true };
  }
  if (appEnv !== "production") {
    return {
      ok: false,
      reason:
        `APP_ENV=${appEnv}: refusing prisma migrate deploy. ` +
        `Use APP_ENV=production (or ALLOW_PRODUCTION_MIGRATE=true) only when explicitly deploying.`,
    };
  }
  const dbHost = hostnameFromUrl(env.DATABASE_URL ?? env.DIRECT_URL);
  if (dbHost && isLocalHostname(dbHost) && env.ALLOW_LOCAL_PROD_INFRA !== "true") {
    return {
      ok: false,
      reason:
        `DATABASE_URL host "${dbHost}" looks local while APP_ENV=production. ` +
        `Refusing migrate deploy against a local database labeled production.`,
    };
  }
  return { ok: true };
}
