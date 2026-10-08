#!/usr/bin/env tsx
/**
 * Guarded production migration entrypoint.
 *
 * Never run against production unless APP_ENV=production
 * (or ALLOW_PRODUCTION_MIGRATE=true with explicit intent).
 *
 * Usage (from repo root):
 *   npm run db:migrate:deploy
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { canRunProductionMigrateDeploy } from "@forgeops/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const schema = path.resolve(here, "../prisma/schema.prisma");

/** Minimal .env loader (no dotenv dependency in @forgeops/db). Does not override existing process.env. */
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

const gate = canRunProductionMigrateDeploy(process.env);
if (!gate.ok) {
  console.error(
    `Refusing migrate deploy:\n  ${gate.reason}\nSee docs/DEPLOYMENT.md.`
  );
  process.exit(1);
}

console.log(
  `[migrate-deploy] APP_ENV=${process.env.APP_ENV ?? "(defaulted)"} — running prisma migrate deploy`
);

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", "--schema", schema],
  { stdio: "inherit", cwd: repoRoot, env: process.env }
);

process.exit(result.status ?? 1);
