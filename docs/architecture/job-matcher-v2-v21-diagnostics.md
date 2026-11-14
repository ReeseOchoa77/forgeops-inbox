# Job Matcher — V2 vs V2.1 diagnostic audit

**Status:** V2 remains the preferred shadow reference. Production default remains `BASELINE`. V2.1 is **not** promoted. Do not implement a new policy until a re-run of the identical 2,474 email IDs verifies dashboard ↔ export ↔ transition matrix reconciliation.

## Pipeline (unchanged architecture)

Ordered markers:

1. **NAME (Marker 1)** — project identity from subject/body (name / alias / siteName / externalRef). Internal `jobNumber` is never evidence.
2. **CONTACT (Marker 2)** — WEAK. Exact sender contacts (MANUAL / authoritative email). Narrows; does not expand a non-empty name set under WEAK rules.
3. **THREAD (Marker 3)** — STRONG. Authoritative same-thread Jobs. May CONFLICT with a disjoint prior candidate set.

Evaluation uses `eligibilityMode: evaluation` and holdout (`excludeEmailMessageId`). Ground truth is never matcher input.

## Exact V2 vs V2.1 deltas

| Area | V2 | V2.1 |
|------|----|------|
| Weak unique NAME | Abstain **and clear** `candidateJobIds` | Abstain **but preserve** candidates |
| Contact AUTH-only single Job | Abstain (`INSUFFICIENT_CONTACT_AUTHORITY`) | May MATCH if independent of thread |
| Family / generic multiword / multi-job / broad / conflict veto | Same | Same |

---

## Priority 1 — CSV / dashboard discrepancy (fixed)

### Root cause

Compare modes score **BASELINE** as primary `result.rows` / `metrics` scaffolding while metric **cards** use `displayMetrics` / `displayIdentityPolicy` (most advanced scored policy, e.g. V2.1).

Detailed CSV exported `result.rows` (BASELINE outcomes) but filenames stamped `displayIdentityPolicy` (V2.1). Aggregating that CSV reproduced BASELINE (~Correct 2,106 / Wrong 171 / Ambiguous 137 / Conflict 56), not the V2.1 dashboard (~1,886 / 24 / 397 / 163).

Exports did **not** recompute predictions with a different policy; they serialized the wrong cached row set.

### Fix

- API builds email list + detailed rows from `evaluatedByPolicy.get(displayIdentityPolicy)`.
- Every row stamped with `identityPolicy`; CSV columns include `evaluation_run_id`, `identity_policy`, `dataset_fingerprint`.
- Server `assertExportRowsMatchMetrics` refuses inconsistent results.
- Client `assertDetailedExportMatchesDashboard` refuses detailed download when row aggregates ≠ dashboard metrics.

### Automated invariant

`packages/shared/src/__tests__/job-match-eval-export-integrity.test.ts` — aggregating export rows must equal dashboard metrics; BASELINE-like rows vs V2.1 metrics must fail.

---

## Priority 2 — Transition “newly wrong” discrepancy (fixed)

### Root cause

Two independent bugs stacked:

1. **Definition mismatch (UI):** “Newly wrong: 6” = `CORRECT→WRONG` + unresolved→WRONG + **`WRONG→WRONG different Job`**. Safety chips showed only the first two (2+2=4), so 6 looked inconsistent with 2+2.
2. **Double-count:** `buildPolicyDiagnosticReport` pre-summed `UNRESOLVED_TO_WRONG` from granular keys, then `summarizeNewlyWrong` added those same granular keys **again**.

Bucket transitions (`CORRECT`/`WRONG`/`UNRESOLVED`) and the granular matrix (`AMBIGUOUS`/`CONFLICT`/`NO_MATCH`) are now derived from the **same** per-email compare rows. `safetyRegressions` reads `diagnostics.newlyWrong` (not a second counter). `assertTransitionMetricsReconcile` verifies the matrix reproduces both policies’ aggregates; UI shows `integrityError` when it does not.

**Canonical formula:**

```
totalNewlyWrong = CORRECT→WRONG + (AMBIGUOUS|CONFLICT|NO_MATCH)→WRONG + WRONG→WRONG_DIFFERENT_JOB
```

CORRECT→CONFLICT is **coverage loss**, not newly wrong.

---

## Priority 3 — V2.1 regression mechanisms (code-verified)

Observed on the user-reported 2,474-email run (pre-integrity-fix metrics; treat as directional until re-exported):

| Metric | V2 | V2.1 | Δ |
|--------|----|------|---|
| Correct | 1,921 | 1,886 | −35 |
| Wrong | 21 | 24 | +3 |
| Ambiguous | 441 | 397 | −44 |
| Conflict | 87 | 163 | +76 |
| No Match | 4 | 4 | 0 |

Attribution (user-reported): `WEAK_CANDIDATE_PRESERVE_THREAD_CONFLICT` 81, `THREAD_RESOLUTION_DELTA` 27, `AUTH_CONTACT_RECOVERY_MATCH` 21, `AUTH_CONTACT_RECOVERY_WRONG` 2.

### A. WEAK_CANDIDATE_PRESERVE_THREAD_CONFLICT (primary — ~79 CORRECT→CONFLICT)

**Code path**

1. Weak unique NAME → V2 clears candidates; V2.1 preserves them (`job-name-identity-policy.ts` `preserveWeakCandidates`).
2. Marker 2 (WEAK) does not expand; may narrow.
3. Marker 3 STRONG thread with a **disjoint** Job → `narrowJobMatchCandidates` returns **CONFLICT** when prior set is non-empty and disjoint.
4. Under V2 the prior set was empty → same thread **expands to MATCH**.

Unit-proven in `job-match-v2_1-regression.test.ts` (“Team follow up” / RISE UP weak hit vs thread Job SAT stairs).

**Authority diagnosis:** preserved WEAK name candidates are given equal footing against STRONG thread evidence in the conflict rule. They should not block authoritative thread resolution when name identity was already abstained as WEAK.

### B. THREAD_RESOLUTION_DELTA (~27)

Residual thread-path outcome changes not classified as weak-preserve (e.g. name candidate count already non-zero under both, or attribution fell through to thread path). Re-export with change reasons to split further.

### C. AUTH_CONTACT_RECOVERY_MATCH / _WRONG (21 / 2)

V2.1 may MATCH on verified authoritative single-Job contact when V2 abstains. Net wrong +3 requires separating newly wrong vs wrong→correct; do not keep AUTH recovery in any follow-on policy unless newly-wrong from that reason is zero on the regression set.

---

## Priority 4 — Verified full-dataset baseline (operator action)

Integrity fixes are in code. A trustworthy matrix still requires:

1. Re-run **Compare V2 vs V2.1** on the identical 2,474 email IDs (same `dataset_fingerprint`).
2. Confirm dashboard metrics = detailed CSV row aggregates for `displayIdentityPolicy`.
3. Confirm `diagnostics.integrityError` is absent.
4. Export Comparison CSV + full JSON; record newly wrong breakdown, CORRECT→CONFLICT, and change-reason histogram.
5. Spot-check representative IDs for `WEAK_CANDIDATE_PRESERVE_THREAD_CONFLICT` and `AUTH_CONTACT_RECOVERY_WRONG`.

Local empty DB cannot regenerate the 2,474 matrix in this environment — use the workspace that holds the evaluation corpus.

---

## Priority 5 — Recommended targeted improvements (V2 reference; do not implement yet)

Keep V2 as the shadow reference. Candidate follow-ons (diagnostic-gated, precision-first):

1. **Do not reintroduce blanket weak-candidate preserve.** If candidates are kept after WEAK abstain, demote them so STRONG thread may still expand / MATCH when disjoint (weak name must not veto thread).
2. **Gate AUTH single-Job contact recovery** behind zero newly-wrong on the holdout; otherwise leave V2 abstain.
3. **Mine V2’s 21 wrongs** from an integrity-clean export before any identity/contact rule change.
4. Prefer recovering **SAFELY_RECOVERABLE** unresolved (GT in final candidates, strong anchor) over expanding weak name evidence.

---

## What this repo now emits

Paired comparisons (`buildIdentityCompareReport`) attach `diagnostics`:

- Granular `CORRECT|WRONG|AMBIGUOUS|CONFLICT|NO_MATCH` → same matrix
- `newlyWrong` vs `wrongToCorrect` tracked independently (no double-count)
- Transition ↔ metrics integrity check
- Change attribution reason codes
- Wrong failure category heuristics
- Baseline unresolved recoverability buckets

Comparison CSV includes decision transition, change reason, candidate counts, and contact reasons (no bodies).

## Production

Unchanged: live matcher omits `identityPolicy` → `BASELINE`.
