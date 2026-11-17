import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { forgeopsUiScalePlugin } from './vite-plugin-fo-ui-scale'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [forgeopsUiScalePlugin(), react()],
  resolve: {
    alias: {
      // Browser-safe shared export — avoid compiling Prisma-bearing shared modules on Vercel.
      '@forgeops/shared/business-subtypes': path.resolve(
        rootDir,
        '../../packages/shared/src/business-subtypes.ts',
      ),
      '@forgeops/shared/inbox-participant-match': path.resolve(
        rootDir,
        '../../packages/shared/src/inbox-participant-match.ts',
      ),
      '@forgeops/shared/reference/normalize': path.resolve(
        rootDir,
        '../../packages/shared/src/reference/normalize.ts',
      ),
      '@forgeops/shared/jobs/job-match-eval-exclusions': path.resolve(
        rootDir,
        '../../packages/shared/src/jobs/job-match-eval-exclusions.ts',
      ),
      '@forgeops/shared/jobs/job-match-eval-ground-truth-corrections': path.resolve(
        rootDir,
        '../../packages/shared/src/jobs/job-match-eval-ground-truth-corrections.ts',
      ),
      '@forgeops/shared/jobs/job-match-performance-score': path.resolve(
        rootDir,
        '../../packages/shared/src/jobs/job-match-performance-score.ts',
      ),
      '@forgeops/shared/jobs/job-match-policy-registry': path.resolve(
        rootDir,
        '../../packages/shared/src/jobs/job-match-policy-registry.ts',
      ),
      '@forgeops/shared/jobs/job-match-multi-policy-compare': path.resolve(
        rootDir,
        '../../packages/shared/src/jobs/job-match-multi-policy-compare.ts',
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  }
})
