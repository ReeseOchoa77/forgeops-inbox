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
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
