# Subtype Discovery Engine (MVP)

**Status:** Experimental / read-only. Available under Manage → Intelligence → Email Classification → Subtype Discovery.

## Architecture summary

1. **Config** — ADMIN/OWNER picks sample size (500 / 2,500 / 10,000 / all / custom), optional mailbox category (default BUSINESS), optional date range.
2. **Enqueue** — API creates `SubtypeDiscoveryRun` and enqueues BullMQ `subtype-discovery` (no sync HTTP discovery).
3. **Sample** — Deterministic stratified sampling across time quintiles (+ mailbox when multiple). Not newest-only.
4. **Prepare** — Prefer `NormalizedEmail.cleanTextBody`; strip quoted replies / disclaimers; truncate; soft-dedupe identical analysis text. Original emails untouched.
5. **Embed** — OpenAI `text-embedding-3-small` in batches of 64.
6. **Cluster** — Cosine connected-components (`cosine-connected-components-v1`). No native HDBSCAN dependency.
7. **Interpret** — LLM interprets up to 20 largest clusters; compares to `BUSINESS_SUBTYPE_*` taxonomy.
8. **Persist** — Summary + recommendation cards on `SubtypeDiscoveryRun` (snippets + ids only; no full bodies in JSON).

**Taxonomy:** Subtypes are BUSINESS-parented today. Discovery defaults to BUSINESS mail. Recommendations never mutate `Classification` or the subtype catalog.

## Safety

- Workspace-scoped queries + Intelligence ADMIN/OWNER gate.
- Email content treated as untrusted in LLM prompts.
- No attachment / full-document upload to models.
- Duplicate in-flight runs rejected (`ALREADY_RUNNING`).
- Cooperative cancel via run status `CANCELLING`.

## Estimated processing cost (order of magnitude)

| Stage | Rough cost drivers |
|-------|--------------------|
| Embeddings | ~$0.02 / 1M tokens (`text-embedding-3-small`); ~1–2k chars/email after truncate |
| Interpret | Up to 20 cluster LLM calls (`OPENAI_SUBTYPE_MODEL` / `chat-latest`) |
| 500 emails | Typically low dollars; dominated by interpret calls |
| 10k emails | Embedding dominates token volume; pairwise clustering capped at 800-core subsample |

Exact $ depends on provider pricing and body lengths. Runs fail clearly if `OPENAI_API_KEY` is missing.

## Recommendation review & approval

ADMIN/OWNER can **Approve / Reject / Edit / Merge / Defer** discovery recommendations:

- **Approve** (with preview + `confirmApply`) creates a workspace-scoped `BusinessType` and a sequential `TaxonomyRevision`. **Does not reclassify historical emails.**
- **Rollback** deactivates the workspace `BusinessType` and records a `ROLLBACK` revision; `Classification.businessTypeKey` values are preserved.
- **Before/after eval** (`SubtypeTaxonomyEvalRun`) compares current vs simulated proposed assignments on the discovery dataset. Precision/confusion only when `ClassificationCorrection` GT exists. Results are labeled **experimental** and can be reopened without rerun.

Migrations: `20261115220000_subtype_discovery_run`, `20261115230000_subtype_recommendation_review`.

## Limitations

- No automatic production classifier redeploy after approval (active BusinessType list updates for future classify candidates).
- No server-side gold evaluation of discovery quality (`evaluation.supported = false` on catalog entry).
- Pairwise clustering uses an 800-point core for large sets (remainder assigned by nearest centroid).
- PERSONAL filter is allowed for exploration but subtypes are not a PERSONAL taxonomy today.
- Proposed eval assignments use discovery supporting email ids (cluster simulation), not a live LLM reclassify.
