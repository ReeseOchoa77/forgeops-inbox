# Job Matcher — V2 vs V2.1 diagnostic audit

**Status:** V2 remains the preferred shadow reference. Production default remains `BASELINE`. V2.1 is **not** promoted. Experimental V3 is deferred until live per-email traces from the 2,474-email set are re-exported with the new diagnostic fields.

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

## Why V2.1 regressed (mechanism)

Observed on the 2,474-email set (user-reported):

- Correct −35, Wrong +3, Ambiguous −44, Conflict **+76**

**Primary mechanism (unit-tested):** preserving weak NAME candidates leaves a non-empty prior set. When Marker 3 has a disjoint authoritative thread Job, `narrowJobMatchCandidates` with STRONG later evidence returns **CONFLICT**. Under V2 the prior set was empty, so the same thread **expands to MATCH**.

That explains the Ambiguous→Conflict shift and many Correct→Conflict losses when the thread Job was the ground-truth Job.

**Secondary mechanism:** AUTH single-Job contact recovery can add Correct *and* Wrong. Net wrong +3 requires separating newly wrong vs wrong→correct (diagnostic `newlyWrong` breakdown).

## What this repo now emits

Paired comparisons (`buildIdentityCompareReport`) attach `diagnostics`:

- Granular `CORRECT|WRONG|AMBIGUOUS|CONFLICT|NO_MATCH` → same matrix
- `newlyWrong` vs `wrongToCorrect` tracked independently
- Change attribution reason codes (e.g. `WEAK_CANDIDATE_PRESERVE_THREAD_CONFLICT`)
- Wrong failure category heuristics
- Baseline unresolved recoverability buckets (A–D)

Comparison CSV includes decision transition, change reason, candidate counts, and contact reasons (no bodies).

## Recommended next steps (ranked)

1. **Retain V2** as preferred shadow policy (done).
2. **Re-run Compare V2 vs V2.1** on the full eligible set; export Comparison CSV / full JSON; use Policy diagnostics panel.
3. **Do not** reintroduce weak-candidate preserve in any V3 without a gated exception that does not conflict with STRONG thread.
4. **AUTH recovery** only if newly-wrong from that reason is zero on the regression set.
5. Analyze V2’s 21 wrongs from the enriched export before proposing V3 identity/contact rules.

## Production

Unchanged: live matcher omits `identityPolicy` → `BASELINE`.
