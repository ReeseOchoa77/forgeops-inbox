/**
 * Safe startup banner — never prints credentials/tokens/URLs with secrets.
 */
import {
  hostnameFromUrl,
  isLocalHostname,
  type AppEnv,
} from "./app-env.js";

export type EnvBootstrapSummary = {
  appEnv: AppEnv;
  nodeEnv: string;
  service: "api" | "worker";
  databaseHostClass: "local" | "remote" | "missing";
  redisHostClass: "local" | "remote" | "missing";
  storageMode: "unset" | "configured";
  frontendIsLocalhost: boolean | null;
};

function hostClass(url: string | undefined): "local" | "remote" | "missing" {
  const host = hostnameFromUrl(url);
  if (!host) return "missing";
  return isLocalHostname(host) ? "local" : "remote";
}

export function buildEnvBootstrapSummary(input: {
  service: "api" | "worker";
  appEnv: AppEnv;
  nodeEnv: string;
  databaseUrl?: string;
  redisUrl?: string;
  s3Bucket?: string | null;
  frontendUrl?: string | null;
}): EnvBootstrapSummary {
  let frontendIsLocalhost: boolean | null = null;
  if (input.frontendUrl) {
    try {
      frontendIsLocalhost = isLocalHostname(new URL(input.frontendUrl).hostname);
    } catch {
      frontendIsLocalhost = null;
    }
  }
  return {
    appEnv: input.appEnv,
    nodeEnv: input.nodeEnv,
    service: input.service,
    databaseHostClass: hostClass(input.databaseUrl),
    redisHostClass: hostClass(input.redisUrl),
    storageMode: input.s3Bucket?.trim() ? "configured" : "unset",
    frontendIsLocalhost,
  };
}

/** One-line human summary for logs. */
export function formatEnvBootstrapLog(summary: EnvBootstrapSummary): string {
  const front =
    summary.frontendIsLocalhost == null
      ? "n/a"
      : summary.frontendIsLocalhost
        ? "localhost"
        : "non-localhost";
  return (
    `ForgeOps environment: ${summary.appEnv.toUpperCase()} ` +
    `(service=${summary.service}, node=${summary.nodeEnv}) | ` +
    `Database: ${summary.databaseHostClass} | Redis: ${summary.redisHostClass} | ` +
    `Storage: ${summary.storageMode} | Frontend: ${front}`
  );
}
