# ForgeOps Intelligence Registry

**Status:** IMPLEMENTED (code-level registry). Manage → Intelligence UI is **PLANNED** and must consume this registry.

Code is the source of truth: `@forgeops/shared` → `intelligence/` (`INTELLIGENCE_CATALOG`, `listDiscoverableIntelligence`, `toIntelligenceSafeDto`).

Related: [overview.md](overview.md), [email-classification.md](email-classification.md), [job-matching.md](job-matching.md), [bidding-active-bids.md](bidding-active-bids.md), [matcher-evaluation.md](../operations/matcher-evaluation.md).

## Purpose

ForgeOps must never gain a **hidden** intelligence system.

Any system that performs meaningful automated classification, extraction, matching, ranking, recommendation, prediction, interpretation, or automated decision-making must be registered in the canonical **Intelligence Registry** so Manage → Intelligence can discover it.

The registry **describes** intelligence. It must **never** become a duplicate implementation of the decision engine.

## What counts as Intelligence

An **Intelligence Component** takes operational input and derives a non-trivial classification, extraction, match, ranking, recommendation, prediction, interpretation, or automated decision.

**Register (examples):**

- Email classifier (AI, deterministic, or hybrid)
- Job matcher / marker pipelines
- Bid/Quote scope extractors
- Scoring / ranking / adjudication systems
- Task inference from email
- Document understanding
- Future ML models, neural nets, or genuine tool-using agents

**Do not register:**

- Ordinary CRUD validation / required-field checks
- Authorization
- Database filtering / sorting / formatting
- Basic UI logic
- Simple business constraints (e.g. “Job number is required”)

Not every `if` is intelligence.

## Intelligence types

| Type | Meaning |
|------|---------|
| `AI_LLM` | Core inference uses an LLM/model API |
| `DETERMINISTIC` | Rules, markers, heuristics, exact matching |
| `HYBRID` | Deterministic processing **and** model inference |
| `ML_MODEL` | Future non-LLM learned / statistical model |
| `AGENT` | Future autonomous tool-using workflow — **not** “calls an LLM once” |

## Registration requirement

A new intelligence system is **not complete** until it is registered.

Markdown docs are for developers/Cursor. **Runtime discovery uses the typed catalog**, not Markdown.

```text
Developer builds intelligence
        ↓
Developer registers in INTELLIGENCE_CATALOG
        ↓
Typed registry / safe DTOs
        ↓
Manage → Intelligence discovers components
```

## Required metadata

Each `IntelligenceDefinition` includes:

- Stable `id` (kebab-case; never display name)
- `name`, `description`, `type`, `status`, `version`, `purpose`
- `implementation` (packages + entryPoints — conceptual, not end-user file paths)
- `inputs` / `outputs`
- `pipeline` (generic nodes + edges for visualization; **not** executable)
- `instructions` (AI: inspection keys into live prompt modules — **no duplicated prompt bodies**)
- `rules` (deterministic/hybrid rule summaries tied to canonical versions)
- `evaluation` (`supported`, `evaluatorId`, metrics, ground-truth quality + notes)
- `explainability` (only capabilities the runtime can actually provide)
- `featureFlags` (env name, default, effect)
- `discoverable` (overview card eligibility)

### Status values

`ACTIVE` · `SHADOW` · `FEATURE_GATED` · `EVALUATION_ONLY` · `LEGACY` · `DISABLED`

### Ground truth

`STRONG` · `MODERATE` · `WEAK` · `NONE`

AI output must **never** be ground truth for evaluating the same AI.

## Prompt / rule inspection

- **AI / hybrid:** registry stores `inspectionKeys` pointing at the **same** code modules used in production. Server adapters resolve keys later. Read-only. No prompt editing in V1.
- **Deterministic:** expose **Rules** (markers, thresholds, authority) — never fake “prompts.”

Do not maintain a second prose copy that drifts from implementation.

## Pipeline metadata

Generic node kinds: `INPUT` · `RULE` · `MARKER` · `MODEL` · `TRANSFORM` · `VALIDATOR` · `DECISION` · `OUTPUT` · `PERSISTENCE`

Metadata drives future visual Pipeline sections. It does not execute the pipeline.

## Evaluation

Declare whether evaluation is supported. If not: `evaluation.supported = false` and explain why.

Server owns execution. Do not put executable evaluators in client DTOs.

Job Matcher reuses the existing historical evaluator (`job-match-historical-eval`). Do not build a parallel evaluator.

## Explainability

Only declare evidence the system actually produces (e.g. matcher `evidence` / `markerTrace`, classification authority, scope `fieldSources`).

## Versioning

Use existing constants (`job-match-pipeline-v3`, `job-name-marker-v3`, `native-openai-pipeline-v1`, etc.). Do not invent fake semver.

## Security

Safe DTOs must not include API keys, OAuth tokens, or private env values. Prompt **bodies** stay server-side behind inspection adapters.

## Manage → Intelligence discovery

```text
GET intelligence registry (safe DTOs)
        ↓
filter discoverable + authorization
        ↓
render cards from registry
        ↓
open detail by stable id
```

Do **not** hard-code one card per system in the UI.

## Material changes

If you change prompts, models, markers, rules, pipeline, output schema, evaluation, ground truth, or feature-flag behavior, update registry metadata / version / notes in the same change.

## Testing requirements

`packages/shared/src/__tests__/intelligence-registry.test.ts` enforces unique ids, required metadata, pipeline integrity, instruction/rule declarations, evaluation/explainability presence, and safe DTO serialization.

## Checklist for adding new intelligence

A new intelligence system is NOT complete until:

- [ ] Intelligence type identified (`AI_LLM` / `DETERMINISTIC` / `HYBRID` / `ML_MODEL` / `AGENT`)
- [ ] Stable intelligence ID assigned (kebab-case)
- [ ] Registered in `INTELLIGENCE_CATALOG`
- [ ] Display metadata provided
- [ ] Pipeline metadata provided
- [ ] Prompt/instructions inspection wired if AI-backed (`inspectionKeys` → live modules)
- [ ] Rules inspection wired if deterministic
- [ ] Explainability capability declared (honest)
- [ ] Evaluation capability declared (`supported` true/false + why)
- [ ] Ground-truth quality declared
- [ ] Version identified from implementation constants where applicable
- [ ] Appropriate tests added / registry tests still pass
- [ ] Manage → Intelligence compatibility verified (`discoverable` set intentionally)
- [ ] Docs updated if architectural behavior changed

Not every intelligence needs an evaluator immediately — but it must still register.
