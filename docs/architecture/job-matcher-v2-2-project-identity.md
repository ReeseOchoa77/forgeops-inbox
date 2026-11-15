# Job Matcher — CONTEXT_AWARE_V2_2 (experimental project identity)

**Status:** Experimental / eval-only. Production remains **`CONTEXT_AWARE_V2`**.  
V2.2 does **not** reintroduce V2.1 weak-candidate preservation.

## Audit — what already existed vs what this refinement adds

| Capability | Prior V2.2 | This refinement |
|------------|------------|-----------------|
| Workspace token DF / phrase index | Yes | + `projectTokenUniqueness`, `competingJobIdsForToken` |
| Gap-tolerant ordered job-phrase subsequence | Contiguous-in-email only | Ordered span in subject/body with intervening budget (`GAP_TOLERANT_MAX_INTERVENING_TOKENS`) |
| Stair/rail inflection | Yes | + drawing/submittal/building/mezzanine pairs |
| Shared family + scope disambiguation | Yes | Unchanged gates; clearer reason codes |
| Distinguishing `#2` recovery | Yes | Unchanged |
| **Unique project token alone** (Example A) | Often fell through as `PROJECT_SCOPE_DISAMBIGUATION`, or blocked short acronyms | **`UNIQUE_PROJECT_TOKEN`** when workspace-rare + phrase-head (SAT/CPAC) |
| Unique token + scope | Bundled as phrase/token | **`UNIQUE_TOKEN_SCOPE_MATCH`** |
| Non-head short unique tokens (`ext`) | Could falsely resolve | Blocked via `isAuthoritativeUniqueProjectToken` |
| Diagnostics | Basic reason/matchedTerms | + `tokenDistance`, `normalizationApplied`, `evidenceField`, `projectTokenUniqueness` |
| Attachments as identity source | Not in Marker 1 | Still out of scope (subject + cleaned body only) |
| V2 / V2.1 behavior | Unchanged | Still unchanged |

## Core principle

**Uniqueness is dynamic and workspace-scoped:** document frequency counts distinct eligible Jobs.  
A meaningful project token in exactly one Job is strong enough to classify alone (when it is an authoritative phrase-head / longer non-generic token).  
When multiple Jobs share it, require scope, distinguishing, or phrase evidence — otherwise stay AMBIGUOUS.

### Evidence hierarchy (deterministic reason codes)

1. `UNIQUE_PROJECT_PHRASE` — contiguous ordered project phrase in email  
2. `GAP_TOLERANT_PROJECT_MATCH` — ordered project/scope terms within intervening budget  
3. `UNIQUE_TOKEN_SCOPE_MATCH` — unique project token + scope/distinguishing  
4. `UNIQUE_PROJECT_TOKEN` — unique authoritative project token alone, no contradiction  
5. `PROJECT_SCOPE_DISAMBIGUATION` — shared family resolved by exclusive scope / building / area  
6. `SHARED_PROJECT_IDENTIFIER` / `ACRONYM_AMBIGUITY` / `GENERIC_TERM_ONLY` — abstain  
7. `CONTRADICTORY_PROJECT_EVIDENCE` — multiple disjoint unique project signals  

Generics (`steel`, `stairs`, `warehouse`, …) never authorize alone via directory uniqueness.

Short tokens (≤3) authorize alone only when they **head** a Job identity phrase (e.g. `SAT`, `CPAC`), not mid-phrase tokens like `ext`.

## Eval

Manage → Intelligence → Job Matcher → **Compare V2 vs V2.2 project-identity (experimental)**.

Baseline V2 (user-reported 2,474-email run): Correct 1,921 / Wrong 21 / Precision 98.92% / Ambiguous 441 / Conflict 87 / No match 4.

### Promotion gates

- More correct than V2  
- **Zero newly wrong** vs V2 on the regression dataset  
- Precision maintained or improved  
- No significant conflict regression  
- Held-out / independently reviewed confirmation  

If gates fail, retain V2. Do not claim corpus success from unit tests alone.

## Production confirmation

`DEFAULT_JOB_MATCH_IDENTITY_POLICY` and registry `productionDefault` remain **`CONTEXT_AWARE_V2`**.
