import { describe, expect, it } from "vitest";
import {
  assertEnvSafety,
  canRunProductionMigrateDeploy,
  collectEnvSafetyIssues,
  hostnameFromUrl,
  isLocalHostname,
  resolveAppEnv,
} from "../env/app-env.js";

describe("resolveAppEnv", () => {
  it("defaults to development", () => {
    expect(resolveAppEnv({})).toBe("development");
    expect(resolveAppEnv({ NODE_ENV: "development" })).toBe("development");
    expect(resolveAppEnv({ NODE_ENV: "test" })).toBe("development");
  });

  it("defaults to production when NODE_ENV=production and APP_ENV unset", () => {
    expect(resolveAppEnv({ NODE_ENV: "production" })).toBe("production");
  });

  it("honors APP_ENV aliases", () => {
    expect(resolveAppEnv({ APP_ENV: "dev" })).toBe("development");
    expect(resolveAppEnv({ APP_ENV: "local" })).toBe("development");
    expect(resolveAppEnv({ APP_ENV: "prod" })).toBe("production");
  });
});

describe("isLocalHostname / hostnameFromUrl", () => {
  it("treats localhost variants as local", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("host.docker.internal")).toBe(true);
    expect(isLocalHostname("192.168.1.10")).toBe(true);
  });

  it("treats Railway-style hosts as remote", () => {
    expect(isLocalHostname("postgres.railway.internal")).toBe(false);
    expect(isLocalHostname("maglev.proxy.rlwy.net")).toBe(false);
  });

  it("parses postgres and redis URLs", () => {
    expect(
      hostnameFromUrl(
        "postgresql://postgres:postgres@localhost:5432/forgeops?schema=public"
      )
    ).toBe("localhost");
    expect(hostnameFromUrl("redis://localhost:6379")).toBe("localhost");
    expect(
      hostnameFromUrl("postgresql://u:p@maglev.proxy.rlwy.net:5432/railway")
    ).toBe("maglev.proxy.rlwy.net");
  });
});

describe("collectEnvSafetyIssues", () => {
  it("blocks remote DB/Redis in development without escape hatch", () => {
    const issues = collectEnvSafetyIssues({
      appEnv: "development",
      databaseUrl: "postgresql://u:p@maglev.proxy.rlwy.net:5432/railway",
      redisUrl: "redis://default:x@redis.railway.internal:6379",
    });
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "DATABASE_URL_REMOTE_IN_DEVELOPMENT",
        "REDIS_URL_REMOTE_IN_DEVELOPMENT",
      ])
    );
  });

  it("allows remote infra in development when ALLOW_REMOTE_INFRA", () => {
    const issues = collectEnvSafetyIssues({
      appEnv: "development",
      databaseUrl: "postgresql://u:p@maglev.proxy.rlwy.net:5432/railway",
      redisUrl: "redis://default:x@redis.railway.internal:6379",
      allowRemoteInfra: true,
    });
    expect(issues).toEqual([]);
  });

  it("blocks local DB in production", () => {
    const issues = collectEnvSafetyIssues({
      appEnv: "production",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/forgeops",
      redisUrl: "redis://localhost:6379",
      sessionCookieSecret: "a".repeat(32),
      tokenEncryptionSecret: "b".repeat(32),
      frontendUrl: "https://forgeops-inbox.com",
    });
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "DATABASE_URL_LOCAL_IN_PRODUCTION",
        "REDIS_URL_LOCAL_IN_PRODUCTION",
      ])
    );
  });

  it("blocks weak secrets and localhost FRONTEND_URL in production", () => {
    const issues = collectEnvSafetyIssues({
      appEnv: "production",
      databaseUrl: "postgresql://u:p@db.example.com:5432/forgeops",
      redisUrl: "redis://redis.example.com:6379",
      sessionCookieSecret: "development-session-secret-change-me",
      tokenEncryptionSecret: "development-token-encryption-secret",
      frontendUrl: "http://localhost:5173",
    });
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "WEAK_SESSION_SECRET",
        "WEAK_TOKEN_ENCRYPTION_SECRET",
        "FRONTEND_URL_LOCAL_IN_PRODUCTION",
      ])
    );
  });

  it("passes a well-formed production env", () => {
    const issues = collectEnvSafetyIssues({
      appEnv: "production",
      databaseUrl: "postgresql://u:p@db.example.com:5432/forgeops",
      redisUrl: "redis://redis.example.com:6379",
      sessionCookieSecret: "a".repeat(32),
      tokenEncryptionSecret: "b".repeat(32),
      frontendUrl: "https://forgeops-inbox.com",
    });
    expect(issues).toEqual([]);
  });

  it("does not require SESSION_COOKIE_SECRET for worker-style production boots", () => {
    const issues = collectEnvSafetyIssues({
      appEnv: "production",
      databaseUrl: "postgresql://u:p@db.example.com:5432/forgeops",
      redisUrl: "redis://redis.example.com:6379",
      tokenEncryptionSecret: "b".repeat(32),
    });
    expect(issues).toEqual([]);
  });

  it("assertEnvSafety throws with codes", () => {
    expect(() =>
      assertEnvSafety({
        appEnv: "development",
        databaseUrl: "postgresql://u:p@maglev.proxy.rlwy.net:5432/railway",
        redisUrl: "redis://localhost:6379",
      })
    ).toThrow(/DATABASE_URL_REMOTE_IN_DEVELOPMENT/);
  });
});

describe("canRunProductionMigrateDeploy", () => {
  it("refuses development", () => {
    const r = canRunProductionMigrateDeploy({
      APP_ENV: "development",
      DATABASE_URL: "postgresql://u:p@db.example.com:5432/x",
    });
    expect(r.ok).toBe(false);
  });

  it("allows production remote DB", () => {
    const r = canRunProductionMigrateDeploy({
      APP_ENV: "production",
      DATABASE_URL: "postgresql://u:p@db.example.com:5432/x",
    });
    expect(r).toEqual({ ok: true });
  });

  it("allows explicit ALLOW_PRODUCTION_MIGRATE escape", () => {
    const r = canRunProductionMigrateDeploy({
      APP_ENV: "development",
      ALLOW_PRODUCTION_MIGRATE: "true",
      DATABASE_URL: "postgresql://u:p@db.example.com:5432/x",
    });
    expect(r).toEqual({ ok: true });
  });
});
