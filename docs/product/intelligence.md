# Manage → Intelligence

ADMIN/OWNER **Intelligence Control Center** for discovering and organizing ForgeOps automated decision systems.

Components are loaded from the canonical **Intelligence Registry** (`INTELLIGENCE_CATALOG` in `@forgeops/shared`). Overview cards map registry safe DTOs — the Control Center groups them into product sections without inventing metrics.

## Navigation hierarchy

- **Overview** — registered systems by category (Email Classification, Job Matcher, Document Intelligence, Workflow Intelligence)
- **Email Classification** — Overview · Type · Subtype · Subtype Taxonomy · Evaluations · Subtype Discovery (experimental read-only recommendations; async BullMQ run; no auto taxonomy changes)
- **Job Matcher** — Overview · Matcher Policies · Historical Evaluations · Policy Comparisons · Evaluation History (session-only until server history exists)
- **Document Intelligence** — registered document/attachment systems only
- **Workflow Intelligence** — registered bidding/intake systems only

Registry **detail** (pipeline / instructions / evaluation / test tabs) remains available via each system’s “Registry detail” link (`?intel=`).

## What you can do

- Browse registered intelligence (type, status, version, evaluation / ground-truth summary)
- Navigate by system category without losing existing tools
- Open a system by stable registry id
- Inspect pipeline metadata, read-only instructions/rules, and explainability notes
- For **Job Matcher**:
  - Dense full-viewport **Evaluation** workspace (config bar + metric strip + Results | Inspector)
  - Flexible dataset builder (All / Specific / Selected Jobs × Total / Per-Job / All-eligible)
  - Eligible count preview before run
  - Aggregate metrics + Emails/Jobs/**Diagnostics** result views + outcome filters
  - Deterministic failure taxonomy, marker precision, GT survival, common confusions
  - Export Summary/Detailed CSV + Full JSON of the completed run (no rematch; no bodies in CSV)
  - Side-panel **Email Inspector** (Email | Match tabs; sanitized body + marker progression)
  - Test One on an existing authoritative email
  - Switch among already-evaluated matcher policies without re-running

## Job Matcher evaluation guarantees

- **Read-only:** no Job assignment, contact learning, Classification/Bid/Customer/Outlook mutations
- **Holdout:** evaluated email excluded from Marker 2/3 evidence
- **No target leakage:** selecting a Job filters ground-truth emails only — matcher is not told the answer
- **Bodies on demand:** evaluation payload does not embed every email body
- **Dataset sizes:** TOTAL samples 100 / 500 / 1000, or All available (`ALL_ELIGIBLE`, uncapped)

See [Intelligence Registry](../architecture/intelligence-registry.md) and [matcher evaluation](../operations/matcher-evaluation.md).

## Refresh / working context

Selected Intelligence component, detail tab, and Job Matcher evaluation **configuration** (plus outcome filter / Emails|Jobs view) restore after reload via URL + scoped workspace persistence.

**In-app navigation** (leave Intelligence → return): completed Job Matcher evaluation results, filters, selection, and scroll restore from SPA session memory — no automatic rerun. **Browser refresh** still clears results (no server EvaluationRun id yet). See [workspace-state-persistence.md](../architecture/workspace-state-persistence.md).

## What you cannot do (V1)

- Edit production prompts, models, or rules
- Auto-run live LLM calls just by opening a page
- Mutate Jobs, emails, contacts, classifications, or Outlook from evaluation/test
- Resume a Manage UI evaluation after refresh without re-running (sync HTTP only)
