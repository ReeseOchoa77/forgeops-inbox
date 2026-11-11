# Job matching

Canonical document for the Email → Job matcher, Job email contacts, authoritative assignment, and auto-assign.

Related: [matcher evaluation](../operations/matcher-evaluation.md), [classification](email-classification.md) (separate system).

## What this is (and is not)

| System | Purpose |
|--------|---------|
| **Email classification** | BUSINESS/PERSONAL + subtype. See [email-classification.md](email-classification.md). |
| **Email → Job matching** | Deterministic candidate Job for an `EmailMessage`. **Not LLM.** |
| **Authoritative assignment** | Whether `EmailMessage.jobId` is trusted as confirmed ownership. |

Live library: `packages/shared/src/jobs/` (`job-match-pipeline-v3`, `job-name-marker-v3`).

Service: `JobMatcherService` → `jobMatchPipelineFromEmailInput`. Optional `aiResolver` is **never passed** by production loaders.

## Pipeline (verified)

```text
Email
  → Marker 1 — project identity (name / alias / siteName / externalRef)
  → candidate Job set
  → Marker 2 — active exact contact (WEAK)
  → candidate narrowing
  → Marker 3 — authoritative mailbox-scoped thread (STRONG)
  → MATCH | AMBIGUOUS | CONFLICT | NO_MATCH
```

Code: `runJobMatchPipeline` in `packages/shared/src/jobs/job-match-pipeline.ts`.

Rules:

- Unique **strong Marker 1 MATCH** stops the pipeline. Later markers do not override it.
- Marker 2 is **WEAK**: may resolve inside the name set, never expand it, never override a unique name MATCH.
- Marker 3 is **STRONG**: a disjoint thread set can produce **CONFLICT**.
- Intersection-before-expansion narrowing (`narrowJobMatchCandidates`).
- MATCH from later markers still records assignment source `AI_AUTO_ASSIGNED` (provenance label, not LLM). The live pipeline **never** emits `JOB_NUMBER_MATCH`.

### Production vs evaluation eligibility

| Mode | Eligible Job statuses |
|------|------------------------|
| `production` (live) | `ACTIVE`, `ON_HOLD`, `AWARDED` only |
| `evaluation` | all statuses (historical holdout). **Must not** be used by the live path |

The Prisma loader (`createPrismaJobMatchLoader`) fetches non-archived Jobs excluding `ARCHIVED`/`CANCELLED`, then Marker 1/2/3 apply the production status filter. COMPLETE / BIDDING / LEAD are loaded but **not** live-matched.

## Marker 1 — project identity

Identity phrases (in order of preparation):

| Source | Field | Used? |
|--------|-------|--------|
| `NAME` | `Job.name` | yes |
| `ALIAS` | `EntityAlias` (`entityType: JOB`) | yes |
| `SITE` | `Job.siteName` | yes |
| `EXTERNAL_REF` | `Job.externalRef` | yes |
| Internal `Job.jobNumber` | `Job.jobNumber` | **no — never identity evidence** |
| `Job.description` | loaded on the record | **not used** by Marker 1 v3 |

Haystack: subject (prefixes stripped) and body (quoted history stripped, 8k cap).

Match kinds: `EXACT` (phrase contained) > `ALL_TOKENS` > `OVERLAP` (any shared content token). A unique hit at the strongest kind is `MATCH`; multiple is `AMBIGUOUS`.

### Identity policy (Marker 1 safety gate)

| Policy | Behavior | Production default? |
|--------|----------|---------------------|
| `BASELINE` | Unique OVERLAP may `MATCH` (historical Marker 1). | **Yes** |
| `CONTEXT_AWARE_V1` | Unique weak identity → `AMBIGUOUS` (candidates preserved for Marker 2/3). Strong multiword / rare single-token / externalRef may still `MATCH`. | No — shadow evaluation only until approved |

Wire-up: `JobMatchInput.identityPolicy` → `runJobNameMarker` / `runJobMatchPipeline`. Live `JobMatcherService` omits the field → `BASELINE`.

**CONTEXT_AWARE_V1 rules (deterministic):**

- Multi-token `EXACT` / `ALL_TOKENS` (≥2 content tokens) → strong.
- Contiguous multiword OVERLAP (phrase subsequence length ≥2 present in email) → strong.
- `EXTERNAL_REF` full-phrase hit → strong.
- Single-token full phrase (e.g. alias `MGCC`) → strong only if workspace-rare (df=1) and not common construction vocabulary.
- Single generic token OVERLAP (`stairs`, `up`, `beam`, …) → weak → abstain.
- Rarity alone never authorizes a match.
- Weak abstention keeps `candidateJobIds` so Marker 2/3 can still resolve; it does **not** early-exit as `MATCH`.

Diagnostics: `identityDiagnostics` on Marker 1 / pipeline results (`identityStrength`, `matchedTerms`, `reason`, `resolutionAllowed`, …).

Shadow compare: Intelligence evaluate with `compareWithIdentityPolicy: "CONTEXT_AWARE_V1"` scores the **same** selected email IDs against the same Job/contact/thread snapshot under both policies and returns transition metrics. Does not change production matching.

### Internal Job number

**Invariant (live matcher):** `Job.jobNumber` is the internal ForgeOps/company identifier. External senders generally do not know it. It is **not** matching evidence.

| Identifier | Role |
|------------|------|
| `Job.jobNumber` | Internal. Never inferred from email text. Never used by Marker 1. |
| `Job.externalRef` | Deliberate external identifier. Valid Marker 1 evidence. |
| `Job.name` / aliases / `siteName` | Project identity evidence. |

`JOB_NUMBER_MATCH` remains on `JobAssignmentSource` and `JobMatchAssignmentSource` for **historical rows**. Evidence types `SUBJECT_JOB_NUMBER` / `CONTENT_JOB_NUMBER` remain in the type union. The live pipeline must not emit them; the evaluator flags if they appear.

## Marker 2 — active exact contact

Code: `packages/shared/src/jobs/job-contact-marker.ts`.

Active contact for the **sender** is:

1. `JobEmailContact.source === MANUAL` for that email, or
2. Another email on the same Job with **authoritative** assignment and the same sender (`CURRENT_AUTHORITATIVE_EMAIL`)

**`LEARNED_FROM_EMAIL` history alone does not count.**

Held-out evaluation excludes the current email id from CURRENT_AUTHORITATIVE_EMAIL proof.

## Marker 3 — authoritative thread

Code: `packages/shared/src/jobs/job-thread-marker.ts`.

Scope: `inboxConnectionId` + `providerThreadId` (thread ids are not globally unique). No majority vote: each distinct authoritative Job on that mailbox thread is one candidate.

## Authoritative `EmailMessage.jobId`

Code: `packages/shared/src/project-folders/verified-folder-job-assignment.ts`.

`isAuthoritativeEmailJobAssignment` / `authoritativeEmailAssignmentOr` are **only**:

- `jobAssignmentIsManual === true`
- `jobAssignmentSource === USER_ASSIGNED`
- `jobAssignmentSource === VERIFIED_PROJECT_FOLDER`

**Not authoritative** (even if `EmailMessage.jobId` is set):

- `AI_SUGGESTED`
- `AI_AUTO_ASSIGNED`
- `JOB_NUMBER_MATCH`
- `FOLDER_ALIAS`
- `IMPORT`
- `Classification.jobId` by itself

Manual Assign Job updates `EmailMessage.jobId` (and linked `Task.jobId`). It does not necessarily update `Classification.jobId`. The two columns can diverge.

## Auto-assignment

Env: `JOB_MATCHER_AUTO_ASSIGN_ENABLED`.

| | |
|---|---|
| Default | **OFF** (missing/empty/false/0 → disabled) |
| Reader | `isJobMatcherAutoAssignEnabled()` in `packages/shared/src/ai-automation-gates.ts` |
| Persistence | `persistJobMatchResult` in API and worker. Returns null and does not write `EmailMessage.jobId` / `Classification.jobId` when off |
| Protected rows | `USER_ASSIGNED` / manual / `VERIFIED_PROJECT_FOLDER` are never stolen even if the flag is on |
| Ambiguous / conflict | `requiresReview`; `selectedJobId` is null — nothing to persist as a MATCH |

**Current production policy: AUTO ASSIGNMENT OFF. Do not turn it on.** 95.01% historical precision is not sufficient (see [matcher-evaluation.md](../operations/matcher-evaluation.md)).

When the gate is off, matcher **candidates may still be computed** (logs `job-match-candidate-not-assigned`). No HTTP “run matcher” endpoint is required for Inbox to function.

Authoritative writes that are **not** gated:

- User Assign Job
- Verified project-folder analyze

Bid-email staging explicitly does **not** call `persistJobMatchResult`.

## JobEmailContact

Model: durable Job ↔ `EntityContact` link. Distinct from `JobParticipant`.

| Field | Behavior |
|-------|----------|
| `source` | `MANUAL` \| `LEARNED_FROM_EMAIL` |
| `firstEmailMessageId` | Set on learn; **SetNull** if that email is deleted — the contact remains |
| `lastSeenAt` | Updated on repeat learn |
| Unique | `@@unique([jobId, contactId])` |

Learning (`learnJobContactFromEmail`):

- Trigger: email already has **authoritative** Job assignment and a valid sender
- Reuses workspace `EntityContact` by normalized email (`findFirst`, oldest)
- Creates `LEARNED_FROM_EMAIL` if no Job↔contact row
- Does not delete contacts; does not match Jobs
- Manual rows stay `MANUAL` (learn updates `lastSeenAt` only)

Deleting an email does **not** remove `JobEmailContact`.

Marker 2 uses **MANUAL** contacts and authoritative-email proof, not learned-only rows.

### Known limitation — EntityContact duplicates

`EntityContact` has an **index** on `(workspaceId, normalizedEmail)` but **no unique constraint**. Concurrent `create` can insert duplicate contacts for the same email. Still true.

## Known Matcher Limitations / Evaluation Findings

These remain possible in Marker 1 v3. They are **not** documented as fixed.

`JOB_NAME_STOP_TOKENS` drops generic words (`project`, `bid`, `quote`, `building`, …). Tokens **not** on that list can become `OVERLAP` identity evidence if they appear in a Job name/alias/site/externalRef and in the email.

Examples that historically produced weak matches and are **still not stopwords** under BASELINE: `up`, `stairs`, `beam`, `point`, `auto`, `rtu`. A unique OVERLAP hit is treated as `MATCH` (`UNIQUE_SUBJECT` / `UNIQUE_BODY`) when `identityPolicy=BASELINE`.

Under `CONTEXT_AWARE_V1`, those generic single-token overlaps abstain (`AMBIGUOUS`) instead of resolving. They are classified via workspace distinctiveness + common construction vocabulary as a **negative signal**, not a permanent stopword list that removes them from tokenization.

Numeric tokens and north/south/east/west are distinguishing (they disambiguate sibling Jobs; they do not generate candidates alone). Tokens shorter than 2 characters are dropped except numerics, so `up` (2 chars) is kept.

**Do not blindly tune Marker 1 against historical labels.** Ground truth is heavily `VERIFIED_PROJECT_FOLDER`; some “wrong” matches may be label errors. See [matcher-evaluation.md](../operations/matcher-evaluation.md).

## Related tests

- `packages/shared/src/__tests__/job-matcher.test.ts`
- `packages/shared/src/__tests__/job-name-marker.test.ts`
- `packages/shared/src/__tests__/job-phase2-markers.test.ts`
- `packages/shared/src/__tests__/job-match-historical-eval.test.ts`
- `packages/shared/src/__tests__/learn-job-contact-from-email.test.ts`
- `packages/shared/src/__tests__/verified-folder-job-assignment.test.ts`
