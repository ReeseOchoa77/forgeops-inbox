# Manage → Intelligence

ADMIN/OWNER surface for discovering ForgeOps automated decision systems.

Components are loaded from the canonical **Intelligence Registry** (`INTELLIGENCE_CATALOG` in `@forgeops/shared`). The page maps registry safe DTOs — it does not hard-code one card per system.

## What you can do

- Browse registered intelligence (type, status, version, evaluation / ground-truth summary)
- Open a system by stable registry id
- Inspect pipeline metadata, read-only instructions/rules, and explainability notes
- For **Job Matcher**: run read-only historical evaluation (sample 50/100/500) and Test One on an existing authoritative email

## What you cannot do (V1)

- Edit production prompts, models, or rules
- Auto-run live LLM calls just by opening a page
- Mutate Jobs, emails, contacts, classifications, or Outlook from evaluation/test

See [Intelligence Registry](../architecture/intelligence-registry.md).
