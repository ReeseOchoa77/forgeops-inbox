import {
  JOB_CONTACT_MARKER_VERSION,
} from "../jobs/job-contact-marker.js";
import { JOB_MATCH_PIPELINE_VERSION } from "../jobs/job-match-pipeline.js";
import { JOB_NAME_MARKER_VERSION } from "../jobs/job-name-marker.js";
import { JOB_THREAD_MARKER_VERSION } from "../jobs/job-thread-marker.js";
import { NATIVE_PIPELINE_MODEL_VERSION } from "../ingestion-ownership.js";
import type { IntelligenceDefinition } from "./types.js";

/**
 * Canonical code-level Intelligence Registry.
 * Adding a qualifying intelligence system requires a new entry here.
 */
export const INTELLIGENCE_CATALOG: readonly IntelligenceDefinition[] = [
  {
    id: "email-classification",
    name: "Email Classification",
    description:
      "Native mailbox classification: semantic signals, BUSINESS/PERSONAL, business subtype, entities, tasks, and priority.",
    type: "HYBRID",
    status: "ACTIVE",
    version: `native-openai-pipeline-${NATIVE_PIPELINE_MODEL_VERSION}`,
    purpose:
      "Classify inbound email for mailbox category, business subtype, entity links, and optional task extraction.",
    implementation: {
      packages: ["@forgeops/native-classification", "@forgeops/ai", "@forgeops/shared"],
      entryPoints: [
        "mailbox-classify worker",
        "runNativeClassificationPipeline",
        "persistNativeClassificationResult",
      ],
    },
    inputs: "Email subject/body, sender, attachment names, classification candidates",
    outputs:
      "Classification row, EmailMessage.mailboxCategory/priority, optional Tasks; Job matcher may run after but LLM does not assign Jobs",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Email + candidates" },
        { id: "semantic", kind: "MODEL", label: "Semantic signals (LLM)" },
        { id: "category", kind: "RULE", label: "BUSINESS / PERSONAL" },
        { id: "subtype", kind: "MODEL", label: "Business subtype (LLM)" },
        { id: "entity", kind: "MODEL", label: "Entity selection (LLM)" },
        { id: "task", kind: "MODEL", label: "Task extraction (LLM)" },
        { id: "priority", kind: "RULE", label: "Priority" },
        { id: "authority", kind: "VALIDATOR", label: "Authority gate" },
        { id: "persist", kind: "PERSISTENCE", label: "Persist Classification" },
        { id: "out", kind: "OUTPUT", label: "Mailbox + Classification" },
      ],
      edges: [
        { from: "in", to: "semantic" },
        { from: "semantic", to: "category" },
        { from: "category", to: "subtype", label: "BUSINESS" },
        { from: "subtype", to: "entity" },
        { from: "entity", to: "task" },
        { from: "task", to: "priority" },
        { from: "priority", to: "authority" },
        { from: "authority", to: "persist" },
        { from: "persist", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: [
        "semanticSignalSystemPrompt",
        "businessSubtypeSystemPrompt",
        "entitySelectionSystemPrompt",
        "taskExtractionSystemPrompt",
      ],
      summary:
        "Centralized system prompts in @forgeops/ai (semantic-signals, business-subtype, entity-selection, task-extraction). User payloads are built dynamically from email + candidates.",
      editable: false,
    },
    rules: {
      available: true,
      summary:
        "Deterministic category/priority decisions and classification authority (USER_EXPLICIT > SYSTEM_DETERMINISTIC > AI). Folder stamps Bid Invites → BID_OPPORTUNITY and Quotes → ESTIMATE_QUOTE.",
      items: [
        {
          id: "mailbox-category",
          title: "BUSINESS / PERSONAL",
          summary:
            "decideMailboxCategoryFlagsCumulative — confirmed sender, strong flags, cumulative threshold; confirmed Job may force PERSONAL → BUSINESS.",
        },
        {
          id: "authority",
          title: "Classification authority",
          summary:
            "USER_EXPLICIT (3) > SYSTEM_DETERMINISTIC (2) > AI (1). Gates subtype replacement; category/summary may still refresh.",
        },
        {
          id: "priority",
          title: "Priority",
          summary: "decideMailboxPriority from job/action/deadline signals — not an LLM decision.",
        },
        {
          id: "bid-task-filter",
          title: "Bid submission task filter",
          summary: "Suppress auto-tasks for raw Bid Opportunity / ITB subjects.",
        },
      ],
    },
    evaluation: {
      supported: true,
      evaluatorId: "classification-parity-and-subtype-shadow",
      metrics: ["accuracy", "precision", "recall", "f1", "per-class", "confusion-matrix"],
      groundTruthQuality: "STRONG",
      groundTruthNotes:
        "USER_EXPLICIT subtype labels are strong GT. Folder SYSTEM_DETERMINISTIC is moderate. AI-written Classification rows must never be GT for the same AI.",
      notes:
        "Partial tooling exists (classification parity, subtype shadow). Prefer USER_EXPLICIT-only GT for subtype AI metrics. Live model re-runs incur OpenAI cost.",
    },
    explainability: {
      available: true,
      capabilities: [
        "classification authority",
        "mailbox category",
        "business subtype",
        "modelName / pipeline version",
        "rawAiPayload when persisted",
      ],
      notes: "Stage-by-stage UI not yet built; evidence exists on Classification / EmailMessage.",
    },
    featureFlags: [],
    discoverable: true,
  },

  {
    id: "job-matcher",
    name: "Job Matcher",
    description:
      "Deterministic Email → Job Marker pipeline (project identity, exact contact, authoritative thread).",
    type: "DETERMINISTIC",
    status: "FEATURE_GATED",
    version: JOB_MATCH_PIPELINE_VERSION,
    purpose:
      "Propose a Job for an EmailMessage. Persistence to EmailMessage.jobId is gated OFF by default.",
    implementation: {
      packages: ["@forgeops/shared"],
      entryPoints: [
        "runJobMatchPipeline",
        "JobMatcherService",
        "persistJobMatchResult",
      ],
    },
    inputs: "Email subject/body/sender/thread + workspace Jobs and contacts",
    outputs: "MATCH | AMBIGUOUS | CONFLICT | NO_MATCH with evidence and markerTrace (in-memory)",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Email" },
        {
          id: "m1",
          kind: "MARKER",
          label: "Marker 1 — Project identity",
          description: JOB_NAME_MARKER_VERSION,
        },
        {
          id: "m2",
          kind: "MARKER",
          label: "Marker 2 — Exact contact",
          description: JOB_CONTACT_MARKER_VERSION,
        },
        {
          id: "m3",
          kind: "MARKER",
          label: "Marker 3 — Authoritative thread",
          description: JOB_THREAD_MARKER_VERSION,
        },
        { id: "decision", kind: "DECISION", label: "MATCH / AMBIGUOUS / CONFLICT / NO_MATCH" },
        { id: "persist", kind: "PERSISTENCE", label: "Persist jobId (gated)" },
      ],
      edges: [
        { from: "in", to: "m1" },
        { from: "m1", to: "m2", label: "if not unique strong MATCH" },
        { from: "m2", to: "m3" },
        { from: "m3", to: "decision" },
        { from: "decision", to: "persist", label: "only if auto-assign ON" },
      ],
    },
    instructions: {
      available: false,
      reason: "Deterministic markers — use Rules, not LLM prompts.",
    },
    rules: {
      available: true,
      summary:
        "Ordered Marker 1→2→3. Internal Job.jobNumber is never live evidence. Live MATCH provenance label AI_AUTO_ASSIGNED is not an LLM call.",
      items: [
        {
          id: "marker-1",
          title: "Marker 1 — Project identity",
          summary:
            "name / alias / siteName / externalRef in subject/body. EXACT > ALL_TOKENS > OVERLAP. Unique strong MATCH stops pipeline.",
          version: JOB_NAME_MARKER_VERSION,
        },
        {
          id: "marker-2",
          title: "Marker 2 — Active exact contact",
          summary:
            "WEAK. MANUAL JobEmailContact or authoritative same-sender emails. Never expands name set; never overrides unique name MATCH.",
          version: JOB_CONTACT_MARKER_VERSION,
        },
        {
          id: "marker-3",
          title: "Marker 3 — Authoritative thread",
          summary:
            "STRONG. Distinct authoritative Jobs on same inboxConnectionId + providerThreadId. Disjoint sets → CONFLICT.",
          version: JOB_THREAD_MARKER_VERSION,
        },
        {
          id: "eligibility",
          title: "Production eligibility",
          summary: "Live matching: ACTIVE / ON_HOLD / AWARDED only. Evaluation mode may use all statuses.",
        },
      ],
    },
    evaluation: {
      supported: true,
      evaluatorId: "job-match-historical-eval",
      metrics: [
        "precision",
        "correct-coverage",
        "wrong-match-rate",
        "ambiguity-rate",
        "conflict-rate",
        "no-match-rate",
      ],
      groundTruthQuality: "MODERATE",
      groundTruthNotes:
        "Authoritative EmailMessage.jobId (USER_ASSIGNED / VERIFIED_PROJECT_FOLDER). Exclude AI_* / JOB_NUMBER_MATCH / IMPORT. Folder labels can be noisy.",
      notes:
        "Reuse evaluate-job-matcher-production + aggregateHistoricalEvalResults. Read-only; holdout excludeEmailMessageId. Documented baseline 500/438/23 is historical, not a live metric.",
    },
    explainability: {
      available: true,
      capabilities: [
        "evidence[]",
        "markerTrace (runtime/eval)",
        "decision",
        "confidence",
        "matcherVersion",
      ],
      notes: "markerTrace is not persisted on EmailMessage today — compute on demand for Test One.",
    },
    featureFlags: [
      {
        envName: "JOB_MATCHER_AUTO_ASSIGN_ENABLED",
        defaultEnabled: false,
        effect:
          "When false, persistJobMatchResult does not write EmailMessage.jobId / Classification.jobId. Candidate computation may still run.",
      },
    ],
    discoverable: true,
  },

  {
    id: "bid-scope-extraction",
    name: "Bid Scope Extraction",
    description:
      "Deterministic Bid/Quote field and detailed-scope extraction with optional LLM enrichment when incomplete.",
    type: "HYBRID",
    status: "ACTIVE",
    version: "bid-email-staging-hybrid-v1",
    purpose:
      "Extract project identity, due dates, amounts, and structured scope for BidCandidate / Quote staging without inventing Jobs.",
    implementation: {
      packages: ["@forgeops/ai", "apps/worker bid-email-analyze"],
      entryPoints: [
        "bid-email-staging-pipeline",
        "extractDetailedScopeDeterministic",
        "OpenAIBidFieldExtractor",
        "OpenAIQuoteFieldExtractor",
      ],
    },
    inputs: "Email subject/body, PDF text/filenames, discovery folders",
    outputs: "Staging fields + DetailedScope with extractionMethod / fieldSources; userEditedFields protected",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Email + documents" },
        { id: "det", kind: "TRANSFORM", label: "Deterministic extraction" },
        { id: "complete", kind: "VALIDATOR", label: "Completeness check" },
        { id: "llm", kind: "MODEL", label: "LLM enrichment" },
        { id: "merge", kind: "TRANSFORM", label: "Merge" },
        { id: "validate", kind: "VALIDATOR", label: "Validation" },
        { id: "out", kind: "OUTPUT", label: "Staging output" },
      ],
      edges: [
        { from: "in", to: "det" },
        { from: "det", to: "complete" },
        { from: "complete", to: "validate", label: "complete" },
        { from: "complete", to: "llm", label: "incomplete" },
        { from: "llm", to: "merge" },
        { from: "merge", to: "validate" },
        { from: "validate", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: [
        "bidFieldExtractionSystemPrompt",
        "quoteFieldExtractionSystemPrompt",
        "SCOPE_DETAIL_PROMPT_RULES",
      ],
      summary:
        "Hardcoded system prompts in @forgeops/ai bidding-analysis modules. Used only when deterministic fields need enrichment.",
      editable: false,
    },
    rules: {
      available: true,
      summary:
        "Completeness requires ≥1 non-generic ITEM. AI merge is conservative. userEditedFields lock re-scan overwrites.",
      items: [
        {
          id: "completeness",
          title: "Scope completeness",
          summary: "detailedComplete iff at least one non-generic ITEM (trade-only/work-only incomplete).",
        },
        {
          id: "user-edited",
          title: "userEditedFields",
          summary: "Manual edits are authoritative; analysis must not overwrite locked fields.",
        },
      ],
    },
    evaluation: {
      supported: false,
      metrics: ["field-level-accuracy", "item-precision", "item-recall"],
      groundTruthQuality: "NONE",
      groundTruthNotes:
        "No systematic human-corrected structured scope dataset for automated accuracy.",
      notes:
        "Do not invent accuracy %. Collect human corrections before enabling evaluation.supported.",
    },
    explainability: {
      available: true,
      capabilities: ["extractionMethod", "fieldSources", "userEditedFields", "deterministic vs AI_ENRICHED"],
      notes: "Per-item origin is tracked when fieldSources / extractionMethod are set.",
    },
    featureFlags: [],
    discoverable: true,
  },

  {
    id: "quote-bid-matching",
    name: "Quote ↔ Bid Matching",
    description:
      "Deterministic quote/project scoring with optional LLM adjudication that cannot auto-MATCH.",
    type: "HYBRID",
    status: "ACTIVE",
    version: "quote-match-hybrid-v1",
    purpose: "Link Quote staging to BidCandidates; keep human confirmation for AI suggestions.",
    implementation: {
      packages: ["@forgeops/ai", "apps/worker bid-email-analyze"],
      entryPoints: ["scoreQuoteToBidCandidate", "OpenAIQuoteMatchAdjudicator", "quote-first-reconstruction"],
    },
    inputs: "Quote staging rows + BidCandidate shortlist",
    outputs: "Match status / suggestions; AI capped below auto-link threshold",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Quote + candidates" },
        { id: "score", kind: "RULE", label: "Deterministic score" },
        { id: "ai", kind: "MODEL", label: "Optional AI adjudicate" },
        { id: "decision", kind: "DECISION", label: "Link / review / human confirm" },
        { id: "out", kind: "OUTPUT", label: "Match status" },
      ],
      edges: [
        { from: "in", to: "score" },
        { from: "score", to: "decision" },
        { from: "score", to: "ai", label: "needs review" },
        { from: "ai", to: "decision" },
        { from: "decision", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: ["quoteMatchAdjudicationSystemPrompt"],
      summary: "Hardcoded adjudicator prompt in @forgeops/ai bidding-analysis/match-adjudication.",
      editable: false,
    },
    rules: {
      available: true,
      summary: "Score thresholds drive auto vs review; AI cannot auto-MATCH.",
      items: [
        {
          id: "thresholds",
          title: "Score thresholds",
          summary: "Deterministic auto-link and review bands (e.g. auto ≥0.55, review ≥0.35).",
        },
      ],
    },
    evaluation: {
      supported: false,
      metrics: ["link-precision"],
      groundTruthQuality: "MODERATE",
      groundTruthNotes: "User-confirmed quote links are moderate GT when collected.",
      notes: "No product evaluator yet; can be built on confirmed links later.",
    },
    explainability: {
      available: true,
      capabilities: ["deterministic score", "AI suggestion (advisory)", "userConfirmedMatch"],
      notes: "Distinguish AI advisory from deterministic auto-link in UI.",
    },
    featureFlags: [],
    discoverable: true,
  },

  {
    id: "existing-job-adjudication",
    name: "Existing Job Adjudication",
    description:
      "Optional LLM adjudication proposing an existing Job for a BidCandidate. Never creates Jobs or writes EmailMessage.jobId.",
    type: "AI_LLM",
    status: "ACTIVE",
    version: "existing-job-adjudicate-v1",
    purpose: "Propose-only existing Job match during bidding analysis.",
    implementation: {
      packages: ["@forgeops/ai"],
      entryPoints: ["OpenAIExistingJobAdjudicator", "matchExistingJobsForCandidates"],
    },
    inputs: "BidCandidate + Job shortlist from deterministic rank",
    outputs: "Propose-only suggestion (no Job invent / no jobId persist)",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Candidate + Jobs" },
        { id: "rank", kind: "RULE", label: "Deterministic shortlist" },
        { id: "ai", kind: "MODEL", label: "LLM adjudicate" },
        { id: "out", kind: "OUTPUT", label: "Propose only" },
      ],
      edges: [
        { from: "in", to: "rank" },
        { from: "rank", to: "ai" },
        { from: "ai", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: ["existingJobAdjudicationSystemPrompt"],
      summary: "Hardcoded existing-job adjudicator prompt in bidding-analysis match module.",
      editable: false,
    },
    rules: {
      available: true,
      summary: "Never creates Jobs; never persists EmailMessage.jobId from this path.",
      items: [
        {
          id: "no-job-invent",
          title: "No Job invention",
          summary: "Bidding analysis must not create Jobs or auto-assign emails to Jobs.",
        },
      ],
    },
    evaluation: {
      supported: false,
      metrics: [],
      groundTruthQuality: "NONE",
      groundTruthNotes: "No dedicated GT set for propose-only adjudication.",
      notes: "Not evaluable until human-labeled proposals exist.",
    },
    explainability: {
      available: true,
      capabilities: ["shortlist", "AI proposal"],
      notes: "Advisory only.",
    },
    featureFlags: [],
    discoverable: true,
  },

  {
    id: "bidding-intake-suggestions",
    name: "Bidding Intake Suggestions",
    description:
      "On-demand hybrid suggestions for Add-to-Bidding form fields. Never creates Jobs or Customers by itself.",
    type: "HYBRID",
    status: "ACTIVE",
    version: "bidding-intake-v1",
    purpose: "Prefill project name / customer / due date suggestions from an email.",
    implementation: {
      packages: ["@forgeops/ai", "apps/api"],
      entryPoints: ["buildBiddingIntakeSuggestions", "OpenAIBiddingIntakeExtractor"],
    },
    inputs: "Email message + deterministic identity hints",
    outputs: "JSON suggestions to client (no Job/Customer create)",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Email" },
        { id: "det", kind: "TRANSFORM", label: "Deterministic hints" },
        { id: "ai", kind: "MODEL", label: "Optional LLM extract" },
        { id: "merge", kind: "TRANSFORM", label: "Merge suggestions" },
        { id: "out", kind: "OUTPUT", label: "Form suggestions" },
      ],
      edges: [
        { from: "in", to: "det" },
        { from: "det", to: "ai" },
        { from: "ai", to: "merge" },
        { from: "det", to: "merge", label: "AI unavailable" },
        { from: "merge", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: ["biddingIntakeSystemPrompt"],
      summary: "Centralized biddingIntakeSystemPrompt in @forgeops/ai/bidding-intake.",
      editable: false,
    },
    rules: {
      available: true,
      summary: "Deterministic identity/due/customer resolve; AI optional if key present.",
      items: [
        {
          id: "no-side-effects",
          title: "No side effects",
          summary: "Suggestions API must not create Jobs or Customers.",
        },
      ],
    },
    evaluation: {
      supported: false,
      metrics: [],
      groundTruthQuality: "NONE",
      groundTruthNotes: "No labeled intake-suggestion dataset.",
      notes: "evaluation.supported=false until GT exists.",
    },
    explainability: {
      available: true,
      capabilities: ["deterministic hints", "AI fields when used"],
      notes: "Client receives merged suggestions.",
    },
    featureFlags: [],
    discoverable: true,
  },

  {
    id: "reference-import-extraction",
    name: "Reference Import Extraction",
    description: "Admin on-demand LLM extraction of Customer/Vendor rows from uploaded file text.",
    type: "AI_LLM",
    status: "ACTIVE",
    version: "import-extract-v1",
    purpose: "Assist Company Data / import workflows with structured record proposals.",
    implementation: {
      packages: ["apps/api"],
      entryPoints: ["POST /import/extract", "ai-import.route"],
    },
    inputs: "Parsed CSV/TXT/PDF/JSON text (size capped)",
    outputs: "Inferred type + records JSON; audit metadata only",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "File text" },
        { id: "model", kind: "MODEL", label: "chat.completions extract" },
        { id: "validate", kind: "VALIDATOR", label: "Zod validate" },
        { id: "out", kind: "OUTPUT", label: "Proposed records" },
      ],
      edges: [
        { from: "in", to: "model" },
        { from: "model", to: "validate" },
        { from: "validate", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: ["importExtractionPrompt"],
      summary: "Hardcoded EXTRACTION_PROMPT in ai-import.route.ts.",
      editable: false,
    },
    rules: {
      available: false,
      reason: "LLM extraction path; validation is ordinary Zod schema checking, not intelligence rules.",
    },
    evaluation: {
      supported: false,
      metrics: [],
      groundTruthQuality: "NONE",
      groundTruthNotes: "Spot human review only.",
      notes: "No automated evaluator.",
    },
    explainability: {
      available: false,
      capabilities: [],
      notes: "Returns inferredType/confidence/records; no rich evidence packet.",
    },
    featureFlags: [],
    discoverable: true,
  },

  {
    id: "knowledge-document-analysis",
    name: "Knowledge Document Analysis",
    description: "Opt-in LLM summary/entities analysis for uploaded knowledge documents.",
    type: "AI_LLM",
    status: "ACTIVE",
    version: "document-ai-v1",
    purpose: "Store compact AI analysis JSON on KnowledgeDocument when runAiAnalysis=true.",
    implementation: {
      packages: ["apps/api"],
      entryPoints: ["runDocumentAiAnalysis", "ingestKnowledgeDocument"],
    },
    inputs: "Document text excerpt",
    outputs: "KnowledgeDocument.aiAnalysisJson / status",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Document text" },
        { id: "model", kind: "MODEL", label: "chat.completions analysis" },
        { id: "persist", kind: "PERSISTENCE", label: "aiAnalysisJson" },
        { id: "out", kind: "OUTPUT", label: "Stored analysis" },
      ],
      edges: [
        { from: "in", to: "model" },
        { from: "model", to: "persist" },
        { from: "persist", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: ["documentAiAnalysisSystemPrompt"],
      summary: "Inline system message in document-library.service runDocumentAiAnalysis.",
      editable: false,
    },
    rules: {
      available: false,
      reason: "Opt-in LLM analysis; skip when API key missing or runAiAnalysis=false.",
    },
    evaluation: {
      supported: false,
      metrics: [],
      groundTruthQuality: "NONE",
      groundTruthNotes: "No labeled document-analysis GT.",
      notes: "evaluation.supported=false.",
    },
    explainability: {
      available: true,
      capabilities: ["stored aiAnalysisJson", "aiAnalysisStatus"],
      notes: "Persisted analysis is the explainability surface.",
    },
    featureFlags: [],
    discoverable: true,
  },

  {
    id: "inline-image-relevance",
    name: "Inline Image Relevance",
    description:
      "Hybrid inline-image relevance: deterministic/hash first; vision LLM gated OFF by default.",
    type: "HYBRID",
    status: "FEATURE_GATED",
    version: "inline-image-relevance-v1",
    purpose: "Classify stored inline images as relevant, noise, or uncertain without deleting them.",
    implementation: {
      packages: ["@forgeops/ai", "apps/worker", "apps/api"],
      entryPoints: [
        "analyzeInlineImageBatch",
        "classifyInlineImageWithVision",
        "inline-image-relevance queue",
      ],
    },
    inputs: "Inline image metadata/bytes",
    outputs: "InlineImageRelevanceClassification rows",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Inline images" },
        { id: "det", kind: "RULE", label: "Deterministic / hash reuse" },
        { id: "vision", kind: "MODEL", label: "Vision LLM (gated)" },
        { id: "persist", kind: "PERSISTENCE", label: "Classification row" },
        { id: "out", kind: "OUTPUT", label: "Relevance label" },
      ],
      edges: [
        { from: "in", to: "det" },
        { from: "det", to: "persist", label: "resolved" },
        { from: "det", to: "vision", label: "needs AI + gate ON" },
        { from: "vision", to: "persist" },
        { from: "persist", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: ["INLINE_IMAGE_RELEVANCE_INSTRUCTIONS"],
      summary: "Centralized INLINE_IMAGE_RELEVANCE_INSTRUCTIONS in @forgeops/ai.",
      editable: false,
    },
    rules: {
      available: true,
      summary: "Deterministic metadata/hash path preferred; vision only when needed and gate enabled.",
      items: [
        {
          id: "det-first",
          title: "Deterministic first",
          summary: "Reuse prior classifications / metadata heuristics before calling vision.",
        },
      ],
    },
    evaluation: {
      supported: false,
      metrics: [],
      groundTruthQuality: "MODERATE",
      groundTruthNotes: "Human corrections exist when the correct path is used.",
      notes: "No batch evaluator productized yet.",
    },
    explainability: {
      available: true,
      capabilities: ["deterministic vs vision path", "stored classification"],
      notes: "Human correct path does not call OpenAI.",
    },
    featureFlags: [
      {
        envName: "INLINE_IMAGE_AI_ANALYZE_ENABLED",
        defaultEnabled: false,
        effect: "When false, analyze enqueue/vision path refuses new AI runs.",
      },
    ],
    discoverable: true,
  },

  {
    id: "classification-parity",
    name: "Classification Parity",
    description:
      "Admin evaluation-only re-run of the native classification pipeline vs historical n8n results. Read-only.",
    type: "HYBRID",
    status: "EVALUATION_ONLY",
    version: `native-openai-pipeline-${NATIVE_PIPELINE_MODEL_VERSION}`,
    purpose: "Compare native pipeline output to historical Classification without DB writes.",
    implementation: {
      packages: ["apps/api", "@forgeops/native-classification", "@forgeops/ai"],
      entryPoints: ["runClassificationParityForMessage", "POST admin classification-parity"],
    },
    inputs: "Historical EmailMessage + n8n Classification",
    outputs: "Comparison DTO (readOnly, dbWrites false)",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Historical message" },
        { id: "native", kind: "MODEL", label: "Native pipeline" },
        { id: "compare", kind: "VALIDATOR", label: "Compare to n8n" },
        { id: "out", kind: "OUTPUT", label: "Parity report" },
      ],
      edges: [
        { from: "in", to: "native" },
        { from: "native", to: "compare" },
        { from: "compare", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: [
        "semanticSignalSystemPrompt",
        "businessSubtypeSystemPrompt",
        "entitySelectionSystemPrompt",
        "taskExtractionSystemPrompt",
      ],
      summary: "Uses the same prompts as email-classification.",
      editable: false,
    },
    rules: {
      available: true,
      summary: "Read-only; must not persist Classification.",
      items: [
        {
          id: "read-only",
          title: "Read-only",
          summary: "dbWrites: false — evaluation only.",
        },
      ],
    },
    evaluation: {
      supported: true,
      evaluatorId: "classification-parity",
      metrics: ["field-diff", "agreement"],
      groundTruthQuality: "WEAK",
      groundTruthNotes: "Historical n8n labels are weak/moderate GT depending on provenance.",
      notes: "Incurs OpenAI cost. Platform admin auth.",
    },
    explainability: {
      available: true,
      capabilities: ["side-by-side native vs historical fields"],
      notes: "Parity response is the explanation.",
    },
    featureFlags: [],
    discoverable: false,
  },

  {
    id: "subtype-shadow",
    name: "Subtype Shadow Validation",
    description: "Admin shadow batch of business-subtype classifier predictions without persisting.",
    type: "AI_LLM",
    status: "SHADOW",
    version: "subtype-v2",
    purpose: "Shadow-validate subtype model outputs for review.",
    implementation: {
      packages: ["apps/api", "@forgeops/ai"],
      entryPoints: ["runSubtypeShadowBatch", "OpenAIBusinessSubtypeClassifier"],
    },
    inputs: "Batch of messages (capped)",
    outputs: "Shadow predictions (persistedToClassification: false)",
    pipeline: {
      nodes: [
        { id: "in", kind: "INPUT", label: "Message batch" },
        { id: "model", kind: "MODEL", label: "Subtype classifier" },
        { id: "out", kind: "OUTPUT", label: "Shadow predictions" },
      ],
      edges: [
        { from: "in", to: "model" },
        { from: "model", to: "out" },
      ],
    },
    instructions: {
      available: true,
      source: "code_module",
      inspectionKeys: ["businessSubtypeSystemPrompt"],
      summary: "Same subtype prompt as live classification.",
      editable: false,
    },
    rules: {
      available: true,
      summary: "Must not write Classification.businessTypeKey.",
      items: [
        {
          id: "no-persist",
          title: "No Classification write",
          summary: "Shadow predictions only.",
        },
      ],
    },
    evaluation: {
      supported: true,
      evaluatorId: "subtype-shadow",
      metrics: ["accuracy", "per-class"],
      groundTruthQuality: "STRONG",
      groundTruthNotes: "Prefer USER_EXPLICIT labels when scoring.",
      notes: "Batch size capped; incurs OpenAI cost. ADMIN/OWNER.",
    },
    explainability: {
      available: true,
      capabilities: ["predicted subtype", "not persisted"],
      notes: "Shadow response payload.",
    },
    featureFlags: [],
    discoverable: false,
  },
];
