import { describe, expect, it } from "vitest";
import {
  buildEnvBootstrapSummary,
  formatEnvBootstrapLog,
} from "../env/bootstrap-log.js";
import { canRunProductionMigrateDeploy, resolveAppEnv } from "../env/app-env.js";

describe("env bootstrap log", () => {
  it("summarizes development without secrets", () => {
    const s = buildEnvBootstrapSummary({
      service: "api",
      appEnv: "development",
      nodeEnv: "development",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/forgeops_dev",
      redisUrl: "redis://localhost:6379",
      s3Bucket: null,
      frontendUrl: "http://localhost:5173",
    });
    expect(s.databaseHostClass).toBe("local");
    expect(s.redisHostClass).toBe("local");
    expect(s.storageMode).toBe("unset");
    expect(s.frontendIsLocalhost).toBe(true);
    const line = formatEnvBootstrapLog(s);
    expect(line).toContain("DEVELOPMENT");
    expect(line).not.toMatch(/postgres:postgres/);
    expect(line).not.toContain("5432/forgeops");
  });

  it("flags remote hosts as remote", () => {
    const s = buildEnvBootstrapSummary({
      service: "worker",
      appEnv: "production",
      nodeEnv: "production",
      databaseUrl: "postgresql://u:p@maglev.proxy.rlwy.net:5432/railway",
      redisUrl: "redis://default:x@redis.railway.internal:6379",
      s3Bucket: "forgeops-production",
    });
    expect(s.databaseHostClass).toBe("remote");
    expect(s.redisHostClass).toBe("remote");
    expect(s.storageMode).toBe("configured");
  });
});

describe("dev reset vs production migrate gates", () => {
  it("production migrate refuses development", () => {
    expect(
      canRunProductionMigrateDeploy({
        APP_ENV: "development",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/forgeops_dev",
      }).ok
    ).toBe(false);
  });

  it("resolveAppEnv defaults development for local NODE_ENV", () => {
    expect(resolveAppEnv({ NODE_ENV: "development" })).toBe("development");
  });
});
