# Job matcher historical evaluation

Operator-only, **read-only** evaluation of the live deterministic matcher against historical authoritative assignments.

Canonical code:

- CLI: `apps/api/src/scripts/evaluate-job-matcher-production.ts`
- Read path: `apps/api/src/application/services/job-match-eval-read.ts`
- Read-only Prisma: `apps/api/src/application/services/read-only-prisma.ts`
- Metrics: `packages/shared/src/jobs/job-match-historical-eval.ts`
- Snapshot loader: `packages/shared/src/jobs/job-match-eval-snapshot-loader.ts`

Architecture: [job-matching.md](../architecture/job-matching.md).

## Safety properties (verified)

| Guarantee | How |
|-----------|-----|
| No HTTP endpoint | CLI only |
| Read-only Prisma | `$extends` blocks create/update/delete/executeRaw |
| No matcher persistence | Script does not import `persist-job-match` |
| No contact learning | Eval loader does not write `JobEmailContact` |
| No queues / Graph / Gmail / S3 / LLM | Snapshot + in-process matcher |
| Workspace required | `--workspace` is mandatory |
| Hold-out | Current email id excluded from Marker 2/3 proof |
| Historical Jobs | `eligibilityMode: evaluation` (includes completed/archived) |
| Ground truth | Authoritative assignments only; `JOB_NUMBER_MATCH` **excluded** |

Do **not** paste production `DATABASE_URL` into Cursor. Run inside the **Railway API service** so the platform injects env.

## How to run (Railway)

After the API image is deployed (script compiled to `apps/api/dist/scripts/evaluate-job-matcher-production.js`):

```bash
NODE=$(command -v node || readlink -f /proc/1/exe)
"$NODE" apps/api/dist/scripts/evaluate-job-matcher-production.js --workspace <WORKSPACE_ID>
```

If `node` is on PATH in that shell:

```bash
npm run evaluate:job-matcher -- --workspace <WORKSPACE_ID>
```

Root script: `node apps/api/dist/scripts/evaluate-job-matcher-production.js`. API package: `node dist/scripts/evaluate-job-matcher-production.js`.

### CLI options

| Flag | Default | Meaning |
|------|---------|---------|
| `--workspace <id>` | required | Workspace to evaluate |
| `--limit <n>` | all eligible | Max emails |
| `--job <jobId>` | all jobs | Restrict to one Job |
| `--max-wrong-details <n>` | 50 | Wrong-match diagnostic rows |
| `--concurrency <n>` | 1, max 4 | In-process parallelism |
| `--help` | | Usage |

## Eligibility

An email is ground truth only if:

- `EmailMessage.jobId` is set
- assignment is authoritative (`USER_ASSIGNED` / `jobAssignmentIsManual` / `VERIFIED_PROJECT_FOLDER`)
- source is **not** `JOB_NUMBER_MATCH`

Thread evidence is mailbox-scoped (`inboxConnectionId` + `providerThreadId`).

## Latest known evaluation baseline

Recorded from a production historical run. Numbers are a snapshot, not a live SLA.

**Workspace dataset**

- Total emails: 2590
- Job-linked: 2474
- Authoritative: 2474
- Jobs represented: 39
- Inbox connections: 1

**Evaluation sample**

- Evaluated: 500
- Correct: 438
- Wrong: 23
- Ambiguous: 29
- Conflict: 9
- No match: 1

**Metrics**

- Precision: 95.01%
- Correct coverage: 87.60%
- Wrong-match rate: 4.60%
- Ambiguity rate: 5.80%
- Conflict rate: 1.80%
- No-match rate: 0.20%

**Marker contribution**

- Marker 1: 407
- Marker 2: 13
- Marker 3: 18
- Marker 2 narrowed but unresolved: 3
- Marker 3 narrowed but unresolved: 1
- Conflicts: 9
- No evidence: 1

**Safety on that run**

- Internal Job number evidence: DISABLED
- `JOB_NUMBER_MATCH` ground truth: EXCLUDED
- `JOB_NUMBER_MATCH` emitted: NONE
- DB writes: NONE
- Auto-assignment: OFF

### Conclusion

**95.01% precision is not sufficient for automatic assignment. `JOB_MATCHER_AUTO_ASSIGN_ENABLED` must remain OFF.**

### Caveat

Ground truth is heavily `VERIFIED_PROJECT_FOLDER`. Some apparent wrong matches may be historical label errors, not matcher errors. Do not blindly optimize Marker 1 against these labels without reviewing failure clusters. Weak identity tokens remain possible; see [job-matching.md](../architecture/job-matching.md#known-matcher-limitations--evaluation-findings).
