# Manage → Intelligence

ADMIN/OWNER surface for discovering ForgeOps automated decision systems.

Components are loaded from the canonical **Intelligence Registry** (`INTELLIGENCE_CATALOG` in `@forgeops/shared`). The page maps registry safe DTOs — it does not hard-code one card per system.

## What you can do

- Browse registered intelligence (type, status, version, evaluation / ground-truth summary)
- Open a system by stable registry id
- Inspect pipeline metadata, read-only instructions/rules, and explainability notes
- For **Job Matcher**:
  - Dense full-viewport **Evaluation** workspace (config bar + metric strip + Results | Inspector)
  - Flexible dataset builder (All / Specific / Selected Jobs × Total / Per-Job / All-eligible)
  - Eligible count preview before run
  - Aggregate metrics + Emails/Jobs result views + outcome filters
  - Side-panel **Email Inspector** (Email | Match tabs; sanitized body + marker progression)
  - Test One on an existing authoritative email

## Job Matcher evaluation guarantees

- **Read-only:** no Job assignment, contact learning, Classification/Bid/Customer/Outlook mutations
- **Holdout:** evaluated email excluded from Marker 2/3 evidence
- **No target leakage:** selecting a Job filters ground-truth emails only — matcher is not told the answer
- **Bodies on demand:** evaluation payload does not embed every email body
- **Sync max:** 1000 emails per Manage UI run (larger ALL_ELIGIBLE refused)

See [Intelligence Registry](../architecture/intelligence-registry.md) and [matcher evaluation](../operations/matcher-evaluation.md).

## Refresh / working context

Selected Intelligence component, detail tab, and Job Matcher evaluation **configuration** (plus outcome filter / Emails|Jobs view) restore after reload via URL + scoped workspace persistence.

**In-app navigation** (leave Intelligence → return): completed Job Matcher evaluation results, filters, selection, and scroll restore from SPA session memory — no automatic rerun. **Browser refresh** still clears results (no server EvaluationRun id yet). See [workspace-state-persistence.md](../architecture/workspace-state-persistence.md).

## What you cannot do (V1)

- Edit production prompts, models, or rules
- Auto-run live LLM calls just by opening a page
- Mutate Jobs, emails, contacts, classifications, or Outlook from evaluation/test
- Resume a Manage UI evaluation after refresh without re-running (sync HTTP only)
