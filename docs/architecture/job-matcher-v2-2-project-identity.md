# Job Matcher — V2.2 unique-token experiment

**Status:** Experimental / eval only. Production default remains `CONTEXT_AWARE_V2`.

**Current revision:** `independent-v21-title-gap-v22-unique-token-r1`

V2.2 is an **independent** branch from production V2:

`CONTEXT_AWARE_V2_2` = current V2 + **unique project token rule ONLY**.

It does **not** include:

- Title-gap / gap-tolerant phrase matching (that is V2.1)
- Weak-candidate preserve
- AUTH contact recovery
- Bundled scope/family distinguishing recovery from the prior V2.2 experiment

## Behavior

| Case | Expected |
|------|----------|
| Unique `SAT` among eligible Jobs + subject `SAT testing complete` | `MATCH` via `UNIQUE_PROJECT_TOKEN` |
| Shared `SAT` across two eligible Jobs | Abstain — no unique-token promotion |
| `Saturday testing` | No SAT match (token boundary) |
| Generic unique `Steel` alone | Not promoted |
| Removed Jobs | Not in eligible pool; do not affect uniqueness |
| Gap-only title evidence with shared SAT | Unresolved under V2.2 (V2.1 may resolve) |

## Historical eval caution

Older evaluation runs labeled `CONTEXT_AWARE_V2_2` without `experimentRevision` used the prior bundled recovery algorithm. Always re-run under the current revision before comparing metrics.

## UI

Manage → Intelligence → Job Matcher → **Compare V2 vs V2.2 (unique-token)**.
