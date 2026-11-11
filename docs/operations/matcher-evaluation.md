# Job matcher historical evaluation

Operator-only, **read-only** evaluation of the live deterministic matcher against historical authoritative assignments.

Canonical code:

- CLI: `apps/api/src/scripts/evaluate-job-matcher-production.ts`
- Manage UI service: `apps/api/src/application/services/run-job-matcher-historical-eval.ts`
- Dataset selection (pure): `packages/shared/src/jobs/job-match-eval-dataset.ts`
- Read path: `apps/api/src/application/services/job-match-eval-read.ts`
- Read-only Prisma (CLI): `apps/api/src/application/services/read-only-prisma.ts`
- Metrics: `packages/shared/src/jobs/job-match-historical-eval.ts`
- Snapshot loader: `packages/shared/src/jobs/job-match-eval-snapshot-loader.ts`

Architecture: [job-matching.md](../architecture/job-matching.md). Product UI: [intelligence.md](../product/intelligence.md).

## Manage → Intelligence evaluation (HTTP)

ADMIN/OWNER only, workspace-scoped:

| Endpoint | Purpose |
|----------|---------|
| `POST .../intelligence/job-matcher/eval-dataset-preview` | Eligible counts before run |
| `POST .../intelligence/job-matcher/evaluate` | Run read-only evaluation |
| `GET .../intelligence/job-matcher/emails/:emailMessageId` | On-demand email inspector body |

### Dataset modes

| Jobs mode | Meaning |
|-----------|---------|
| `ALL` | All Jobs with authoritative ground-truth emails |
| `SPECIFIC` | Exactly one Job (GT filter only) |
| `SELECTED` | Multiple Jobs (GT filter only) |

| Sampling | Meaning |
|----------|---------|
| `TOTAL` | N emails total (round-robin across Jobs) |
| `PER_JOB` | N emails from each Job in scope |
| `ALL_ELIGIBLE` | Every eligible email in scope (refused if over sync max 1000) |

Job lifecycle filter (`ALL` / `CURRENT` / `ARCHIVED`) filters which ground-truth Jobs contribute emails. Default `ALL` matches historical CLI behavior.

**No target leakage:** selecting a Job only filters which emails are evaluated. The matcher still runs with `eligibilityMode: evaluation` against the full evaluation Job pool. The selected Job is never passed as expected/target evidence.

**Holdout:** `excludeEmailMessageId` continues to exclude the evaluated email from Marker 2/3 proof.

**Bodies:** evaluation result rows include IDs + matcher evidence only. Full From/To/Cc/body/attachments load on inspector click.

### Diagnostics (deterministic)

Computed in `packages/shared/src/jobs/job-match-eval-diagnostics.ts` **after** matcher execution. Ground truth is never fed into the matcher.

| Concept | Definition |
|---------|------------|
| Resolving marker | First trace marker with `status=MATCH` (NAME → CONTACT → THREAD) |
| Contributing markers | Markers that MATCH or narrow the after-stage candidate set |
| Failure category (exclusive, WRONG MATCH only) | `MULTI_MARKER_INTERACTION` if >1 contributing marker; else PROJECT_IDENTITY / CONTACT / THREAD / OTHER from resolving marker |
| Project identity subcategory | Canonical NAME evidence family: JOB_NAME / ENTITY_ALIAS / SITE_NAME / EXTERNAL_REF |
| Marker precision | Correct / (Correct + Wrong) among unique MATCH rows resolved by that marker |
| GT survival | `trueJobId ∈` after-stage `candidateJobIds` for that marker (eval overlay) |
| First GT loss stage | First marker where GT leaves the after-stage candidate set |
| Common confusions | Wrong MATCH pairs (actual Job → predicted Job) by count |

UI: Results → **Diagnostics** (Failure / Marker Performance / Candidate / Confusions). Category clicks filter the email list.

### Export (client, no rematch)

From a completed evaluation: Summary CSV, Detailed CSV (one row/email, **no bodies**), Full JSON. Optional Detailed CSV of **current filtered** rows. Export uses the viewed result only — matcher is not re-run.

## Safety properties (verified)

| Guarantee | How |
|-----------|-----|
| CLI remains available | Railway script unchanged in purpose |
| Manage UI is ADMIN/OWNER | Intelligence route auth |
| No matcher persistence | Service does not import `persist-job-match` |
| No contact learning | Eval loader does not write `JobEmailContact` |
| No queues / Graph / Gmail / S3 / LLM | Snapshot + in-process matcher |
| Workspace required | Path param + membership check |
| Hold-out | Current email id excluded from Marker 2/3 proof |
| No target leakage | Job selection is GT dataset filter only |
| Historical Jobs | `eligibilityMode: evaluation` (includes completed/archived) |
| Ground truth | Authoritative assignments only; `JOB_NUMBER_MATCH` **excluded** |
| Sync ceiling | Max 1000 emails per Manage UI run |

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
