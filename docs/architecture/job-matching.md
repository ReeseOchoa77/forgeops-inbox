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
| `evaluation` | production + `COMPLETE` / `COMPLETED` / `ARCHIVED` (historical awarded Jobs) |

**Never eligible (any mode):** `LEAD`, `BIDDING` (active/pre-award bids), `CANCELLED` (canceled/lost), and any Job with `archivedAt != null` (removed from the directory).

Shared helpers: `isJobMatcherEligibleStatus`, `isJobMatcherEligibleJob`, `filterJobsEligibleForMatching` in `job-name-marker.ts`. Applied before Marker 1/2/3 candidate generation for every identity policy (V2, V2.2, …).

The Prisma loader (`createPrismaJobMatchLoader`) loads only live eligible statuses with `archivedAt IS NULL`. Historical eval snapshots still load all Jobs for ground-truth labels; matching filters via evaluation eligibility. Eval diagnostics set `trueJobEligibleAsCandidate` when the historical label is no longer in the candidate pool.

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
| `BASELINE` | Unique OVERLAP may `MATCH` (historical Marker 1). | No — eval only |
| `CONTEXT_AWARE_V1` | Unique weak identity → `AMBIGUOUS` (candidates preserved for Marker 2/3). Strong multiword / rare single-token / externalRef may still `MATCH`. | No — eval only |
| `CONTEXT_AWARE_V2` | V1 + shared customer/family disambiguation + generic multiword rejection; weak clears candidates; contact safety (multi-job / AUTH-email-only abstain; MANUAL single-job may resolve). | **Yes** |
| `CONTEXT_AWARE_V2_1` | Independent experiment = current V2 + **title-gap only** (gap-tolerant ordered project-title matching). Does not include unique-token promotion, weak-candidate preserve, or AUTH contact recovery. | No — experimental / eval only |
| `CONTEXT_AWARE_V2_2` | Independent experiment = current V2 + **unique project token only**. Does not include title-gap matching. | No — experimental / eval only |

Wire-up: `JobMatchInput.identityPolicy` → `runJobNameMarker` / `runJobMatchPipeline`. Live `JobMatcherService` omits the field → `CONTEXT_AWARE_V2` (`DEFAULT_JOB_MATCH_IDENTITY_POLICY`).

**CONTEXT_AWARE_V1 rules (deterministic):**

- Multi-token `EXACT` / `ALL_TOKENS` (≥2 content tokens) → strong.
- Contiguous multiword OVERLAP (phrase subsequence length ≥2 present in email) → strong.
- `EXTERNAL_REF` full-phrase hit → strong.
- Single-token full phrase (e.g. alias `MGCC`) → strong only if workspace-rare (df=1) and not common construction vocabulary.
- Single generic token OVERLAP (`stairs`, `up`, `beam`, …) → weak → abstain.
- Rarity alone never authorizes a match.
- Weak abstention keeps `candidateJobIds` so Marker 2/3 can still resolve; it does **not** early-exit as `MATCH`.

**CONTEXT_AWARE_V2 additions (deterministic):**

- Project family via shared `customerId` and/or shared identity tokens (workspace-derived; no hardcoded names).
- Customer-only phrase among a family → `SHARED_CUSTOMER_IDENTITY` abstain; distinguishing sibling tokens may reselect.
- Contiguous multiword OVERLAP rejected when entirely generic construction vocabulary or shared across Jobs (`GENERIC_MULTIWORD_OVERLAP`).
- Weak identity clears candidates so Marker 2/3 can expand freely.
- Contact: multi-job / broad (≥4) cannot unique-resolve; AUTH-email-only insufficient; MANUAL single-job may resolve; weak-name∩contact intersection abstains.
- Marker 3 largely unchanged; holdout unchanged; internal `jobNumber` still never evidence.

**CONTEXT_AWARE_V2_1 additions (deterministic, independent of V2.2):**

- Same V2 identity + contact gates (weak candidates **cleared**; AUTH-only contacts still abstain).
- Gap-tolerant / contiguous ordered project-title recovery only (`GAP_TOLERANT_PROJECT_MATCH` / `UNIQUE_PROJECT_PHRASE`).
- Does **not** promote unique single tokens.
- Preserves V2 family/umbrella abstentions (`SHARED_CUSTOMER_IDENTITY` is not overridden by title-gap).

**CONTEXT_AWARE_V2_2 additions (deterministic, independent of V2.1):**

- Same V2 identity + contact gates (weak candidates **cleared**).
- **Unique authoritative project token alone** may `MATCH` (`UNIQUE_PROJECT_TOKEN`) when workspace df=1 and the token heads a Job phrase (e.g. unique `SAT`); generics never authorize alone.
- Unique token + optional scope decoration → `UNIQUE_TOKEN_SCOPE_MATCH`.
- Does **not** apply title-gap phrase matching.
- Shared tokens never promote; removed / non-eligible Jobs are not in the live pool and do not affect uniqueness.
- Diagnostics: `tokenDistance`, `normalizationApplied`, `evidenceField`, `projectTokenUniqueness`.

Revision stamp: `JOB_MATCH_IDENTITY_EXPERIMENT_REVISION` on historical eval payloads. Older V2.1/V2.2 eval runs without this stamp used prior algorithms under the same policy ids — do not treat them as the current independent experiments.

Diagnostics: `identityDiagnostics` + `contactDiagnostics` on pipeline results.

Shadow compare: `compareWithIdentityPolicy` = `CONTEXT_AWARE_V1` | `CONTEXT_AWARE_V2` | `CONTEXT_AWARE_V2_1` | `CONTEXT_AWARE_V2_2` | `ALL_THREE` on the same email IDs/snapshot. Primary Evaluation metric cards prefer the production policy (`CONTEXT_AWARE_V2`) when it was scored; otherwise the single-policy primary.

### Internal Job number

**Invariant (live matcher):** `Job.jobNumber` is the internal ForgeOps/company (TEK STEEL) identifier. External senders generally do not know it. It is **not** matching evidence for candidate generation, scoring, filtering, or final assignment.

| Identifier | Role |
|------------|------|
| `Job.jobNumber` | Internal. Never inferred from email text. Never indexed by Marker 1. OK for DB ids, UI labels, and ground-truth display. |
| `Job.externalRef` | Deliberate external identifier. Valid Marker 1 evidence **only when it differs from** `Job.jobNumber`. |
| `Job.name` / aliases / `siteName` | Project identity evidence. Phrases that are *exactly* equal to `Job.jobNumber` are skipped (data-quality contamination guard). |

Ground-truth `jobId` / job numbers / folder labels are never passed into `matcher.match` as prediction features.

`JOB_NUMBER_MATCH` remains on `JobAssignmentSource` and `JobMatchAssignmentSource` for **historical rows**. Evidence types `SUBJECT_JOB_NUMBER` / `CONTENT_JOB_NUMBER` remain in the type union. The live pipeline strips them if present; the evaluator flags if they appear. Audit: [job-matcher-internal-job-number-audit.md](./job-matcher-internal-job-number-audit.md).

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
