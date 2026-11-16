# Job Matcher — V2 vs V2.1 (title-gap experiment)

**Status:** Production default is `CONTEXT_AWARE_V2`. V2.1 remains experimental / eval-only and is **not** promoted.

**Current revision:** `independent-v23-normalized-subject-identity-r1`

Note: V2.3 (`CONTEXT_AWARE_V2_3` — Normalized Subject Identity) is a separate independent experiment registered alongside V2.1/V2.2. It does not change V2.1/V2.2 semantics; the shared `experimentRevision` stamp was bumped when V2.3 shipped.

## Current V2.1 definition

`CONTEXT_AWARE_V2_1` = current V2 + **title-gap rule ONLY** (shared-id subject/body disambiguation included).

Inactive (legacy algorithms that reused this policy id):

- Weak-candidate preserve
- AUTH single-Job contact recovery
- Unique-token promotion (that is V2.2)

## Exact V2 vs V2.1 deltas (current revision)

| Area | V2 | V2.1 |
|------|----|------|
| Family / generic / conflict gates | Active | Same |
| Weak candidates | Cleared | Cleared (same as V2) |
| Contact AUTH-only | Abstain | Abstain (same as V2) |
| Gap-tolerant ordered title matching | No | Yes |
| Shared-id body distinguishing evidence | No | Yes (`UNIQUE_BODY_DISAMBIGUATION`) |
| Unique single-token promotion | No | No |

## Historical eval caution

Older V2 vs V2.1 comparison docs and metrics in this file’s history referred to the **prior** weak-preserve / AUTH-recovery V2.1. Those numbers must not be treated as results for the current title-gap experiment. Re-run Compare V2 vs V2.1 after deploy and confirm `experimentRevision` on the result payload.

## Operator next step

1. Re-run **Compare V2 vs V2.1 (title-gap)** on the same eligible dataset / fingerprint used for the V2 baseline (reference: 2,651 evaluated / 2,129 correct / 14 wrong / 475 ambiguous / 27 conflict / 6 no match — dataset-specific, not hardcoded).
2. Prefer precision + newly-wrong over coverage-only improvement before any promotion discussion.
3. Do **not** promote V2.1 to production from this experiment alone.
