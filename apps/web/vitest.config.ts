import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@forgeops/shared/business-subtypes": path.resolve(
        rootDir,
        "../../packages/shared/src/business-subtypes.ts"
      ),
      "@forgeops/shared/inbox-participant-match": path.resolve(
        rootDir,
        "../../packages/shared/src/inbox-participant-match.ts"
      ),
      "@forgeops/shared/bidding/scope-detail": path.resolve(
        rootDir,
        "../../packages/shared/src/bidding/scope-detail.ts"
      ),
      "@forgeops/shared/reference/normalize": path.resolve(
        rootDir,
        "../../packages/shared/src/reference/normalize.ts"
      ),
      "@forgeops/shared/jobs/job-match-eval-exclusions": path.resolve(
        rootDir,
        "../../packages/shared/src/jobs/job-match-eval-exclusions.ts"
      ),
      "@forgeops/shared/jobs/job-match-performance-score": path.resolve(
        rootDir,
        "../../packages/shared/src/jobs/job-match-performance-score.ts"
      ),
      "@forgeops/shared/jobs/job-match-policy-registry": path.resolve(
        rootDir,
        "../../packages/shared/src/jobs/job-match-policy-registry.ts"
      ),
      "@forgeops/shared/jobs/job-match-multi-policy-compare": path.resolve(
        rootDir,
        "../../packages/shared/src/jobs/job-match-multi-policy-compare.ts"
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
