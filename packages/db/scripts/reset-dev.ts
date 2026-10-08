#!/usr/bin/env tsx
/**
 * DEVELOPMENT-ONLY database reset.
 *
 * Drops and recreates the local Prisma schema via `prisma migrate reset`.
 * Fail-closed: refuses anything that is not APP_ENV=development on a local host.
 *
 * Usage (repo root):
 *   npm run db:reset:dev
 *
 * NEVER run against production.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  canRunProductionMigrateDeploy,
  hostnameFromUrl,
  isLocalHostname,
  resolveAppEnv,
} from "@forgeops/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const schema = path.resolve(here, "../prisma/schema.prisma");

function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv(path.resolve(repoRoot, ".env"));
loadDotEnv(path.resolve(here, "../.env"));

const appEnv = resolveAppEnv(process.env);
if (appEnv !== "development") {
  console.error(
    `Refusing db:reset:dev — APP_ENV=${appEnv}. This command is development-only.`
  );
  process.exit(1);
}

// Extra safety: never allow the production-migrate escape hatch to unlock reset.
if (process.env.ALLOW_PRODUCTION_MIGRATE === "true") {
  console.error(
    "Refusing db:reset:dev while ALLOW_PRODUCTION_MIGRATE=true is set."
  );
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
const host = hostnameFromUrl(dbUrl);
if (!host || !isLocalHostname(host)) {
  console.error(
    `Refusing db:reset:dev — DATABASE_URL host "${host ?? "(missing)"}" is not local.\n` +
      `Development reset only works against localhost / docker-compose Postgres.`
  );
  process.exit(1);
}

// Sanity: production migrate gate should refuse this env (inverse check).
const prodGate = canRunProductionMigrateDeploy({
  ...process.env,
  APP_ENV: "development",
});
if (prodGate.ok) {
  console.error("Internal guard inconsistency — aborting reset.");
  process.exit(1);
}

console.log(
  `[db:reset:dev] APP_ENV=development host=${host} — running prisma migrate reset`
);
console.log(
  "[db:reset:dev] This DESTROYS local development data only. Production is untouched."
);

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "reset", "--force", "--schema", schema],
  { stdio: "inherit", cwd: repoRoot, env: process.env }
);

process.exit(result.status ?? 1);
