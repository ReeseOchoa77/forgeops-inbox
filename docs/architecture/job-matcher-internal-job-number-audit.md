# Job Matcher — Internal Job number audit

**Date:** 2026-11-14  
**Production default:** unchanged (`BASELINE`). Shadow policies V1/V2/V2.1 share the same Marker 1 phrase index.

## Philosophy

Match emails on **project identity and contextual evidence**, not internal TEK STEEL `Job.jobNumber` values that appear in subjects, bodies, attachment names, or threads.

## Audit findings

### Live Job Matcher (BASELINE / V1 / V2 / V2.1)

| Surface | Uses internal `jobNumber` as positive evidence? |
|---------|--------------------------------------------------|
| Marker 1 (`job-name-marker` / `prepareJobs`) | **No** — phrases from name / alias / siteName / externalRef only |
| Marker 2 (contact) | **No** — uses `job.id` + contact rows |
| Marker 3 (thread) | **No** — authoritative `EmailMessage.jobId` on thread, not number tokens |
| Identity / contact policies | **No** — do not read `job.jobNumber` |
| Assignment source | Never emits `JOB_NUMBER_MATCH` (historical label only) |
| Historical eval | Does not pass GT job id/number into `matcher.match` |

Legacy type members `SUBJECT_JOB_NUMBER` / `CONTENT_JOB_NUMBER` / `JOB_NUMBER_MATCH` remain for **historical DB rows** and eval tripwires (`internalJobNumberEvidenceCount`, `jobNumberMatchEmittedCount`).

### Residual risks addressed

1. **Data contamination:** if `Job.name`, alias, `siteName`, or `externalRef` literally equals `Job.jobNumber`, that phrase is **not indexed** (`phraseEqualsInternalJobNumber`).
2. **Defense in depth:** pipeline `toResult` strips forbidden job-number evidence types and remaps accidental `JOB_NUMBER_MATCH` → `AI_AUTO_ASSIGNED`.

### Outside Job Matcher (not changed)

| System | Notes |
|--------|-------|
| Project folder match | May use folder name ↔ `Job.jobNumber` for `/Projects` folders |
| Classification candidates | May score `folder.detectedJobNumber` in subject/body/attachments |
| Bid staging / AI prompts | Separate surfaces; not the deterministic Job Matcher |

## Smallest code changes (implemented)

1. `phraseEqualsInternalJobNumber` + skip contaminated phrases in `prepareJobs`.
2. Strip forbidden evidence / assignment sources in `toResult`.
3. Invariance tests: adding/removing internal job-number text from an email must not change the predicted Job when project identity remains.
4. Contaminated name/externalRef regression test.

## Benchmark (2,474 emails)

Production matching behavior for BASELINE is unchanged except the contamination guard (only affects Jobs whose identity fields equal their internal number).

**This environment:** local `forgeops_dev` has `0` authoritative emails, so the 2,474-email V2 matrix cannot be regenerated here.

**Operator next step (after deploy):** on the workspace that holds the corpus, run Evaluation → Compare V2 vs V2.1 (or Current → V2) with All available / same selected IDs. Confirm:

- `jobNumberMatchEmittedCount === 0`
- `internalJobNumberEvidenceCount === 0`
- Dashboard ↔ detailed export integrity holds
- Report correct / wrong / precision / coverage / decision transitions vs prior V2 baseline

Expected: near-identical V2 aggregates vs the prior clean run, unless contaminated identity fields previously caused false matches on bare job numbers.
