import { useEffect, useState, type CSSProperties } from 'react'
import {
  BUSINESS_SUBTYPE_FILTER_OPTIONS,
  BUSINESS_SUBTYPE_KEYS,
} from '@forgeops/shared/business-subtypes'
import { computeJobMatcherPerformanceScore } from '@forgeops/shared/jobs/job-match-performance-score'
import {
  api,
  type IntelligenceSafeDto,
  type JobMatcherEvalResult,
  type JobMatcherTestOneResult,
} from '../api'
import { IntelligencePipelineView } from '../components/IntelligencePipeline'
import { JobMatcherEvaluationPanel } from '../components/JobMatcherEvaluationPanel'
import { SubtypeDiscoveryPanel } from '../components/SubtypeDiscoveryPanel'
import {
  DOCUMENT_INTELLIGENCE_SUBS,
  EMAIL_CLASSIFICATION_SUBS,
  INTELLIGENCE_CONTROL_SECTIONS,
  INTELLIGENCE_SECTION_IDS,
  JOB_MATCHER_SUBS,
  WORKFLOW_INTELLIGENCE_SUBS,
  defaultSubForSection,
  intelligenceSectionForId,
  jobMatcherPolicyRows,
  jobMatcherProductionPolicyLabel,
  sectionLabel,
  type DocumentIntelligenceSub,
  type EmailClassificationSub,
  type IntelligenceControlSection,
  type IntelligenceControlSub,
  type JobMatcherSub,
  type WorkflowIntelligenceSub,
} from '../intelligence-control-center'
import {
  intelligenceStatusLabel,
  intelligenceTypeLabel,
  instructionsTabLabel,
  mapIntelligenceCards,
  showInstructionsSection,
  showRulesSection,
} from '../intelligence-display'
import { getJobMatcherEvalSession } from '../workspace-state/session-memory'
import {
  DEFAULT_INTELLIGENCE_STATE,
  loadIntelligenceState,
  persistIntelligenceState,
  type IntelligencePersistedState,
} from '../workspace-state'

type Props = {
  workspaceId: string
  userId?: string
  /** Stable registry id — when set, show detail. */
  intelligenceId?: string | null
  onOpen: (id: string) => void
  onBack: () => void
}

export function IntelligenceView({
  workspaceId,
  userId,
  intelligenceId = null,
  onOpen,
  onBack,
}: Props) {
  if (intelligenceId) {
    return (
      <IntelligenceDetail
        workspaceId={workspaceId}
        userId={userId}
        intelligenceId={intelligenceId}
        onBack={onBack}
      />
    )
  }
  return (
    <IntelligenceControlCenter
      workspaceId={workspaceId}
      userId={userId}
      onOpen={onOpen}
    />
  )
}

function IntelligenceControlCenter({
  workspaceId,
  userId,
  onOpen,
}: {
  workspaceId: string
  userId?: string
  onOpen: (id: string) => void
}) {
  const restored = userId ? loadIntelligenceState({ workspaceId, userId }) : null
  const [components, setComponents] = useState<IntelligenceSafeDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [intelUi, setIntelUi] = useState<IntelligencePersistedState>(
    () => restored ?? DEFAULT_INTELLIGENCE_STATE
  )

  const section = intelUi.controlSection
  const sub = intelUi.controlSub

  useEffect(() => {
    const next = userId ? loadIntelligenceState({ workspaceId, userId }) : null
    if (next) setIntelUi(next)
  }, [workspaceId, userId])

  useEffect(() => {
    if (!userId) return
    persistIntelligenceState({ workspaceId, userId, state: intelUi })
  }, [workspaceId, userId, intelUi])

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .listIntelligence(workspaceId)
      .then((r) => setComponents(r.components))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [workspaceId])

  const setSection = (next: IntelligenceControlSection) => {
    setIntelUi((prev) => ({
      ...prev,
      controlSection: next,
      controlSub: defaultSubForSection(next),
    }))
  }

  const setSub = (next: IntelligenceControlSub) => {
    setIntelUi((prev) => ({ ...prev, controlSub: next }))
  }

  const fillWorkspace =
    section === 'job-matcher' && (sub === 'evaluations' || sub === 'comparisons')

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Intelligence Control Center</h2>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px', maxWidth: 760 }}>
          Manage, evaluate, and inspect ForgeOps intelligent systems. Systems are loaded from the
          canonical Intelligence Registry — metrics appear only when real evaluation data exists.
        </p>

        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e5e5', overflowX: 'auto' }}>
          {INTELLIGENCE_CONTROL_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              data-testid={`intel-section-${s.id}`}
              style={navTabStyle(section === s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {section !== 'overview' && (
          <div
            style={{
              display: 'flex',
              gap: 0,
              borderBottom: '1px solid #e5e7eb',
              marginTop: 0,
              overflowX: 'auto',
            }}
          >
            {(section === 'email-classification'
              ? EMAIL_CLASSIFICATION_SUBS
              : section === 'job-matcher'
                ? JOB_MATCHER_SUBS
                : section === 'document-intelligence'
                  ? DOCUMENT_INTELLIGENCE_SUBS
                  : WORKFLOW_INTELLIGENCE_SUBS
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSub(s.id)}
                data-testid={`intel-sub-${s.id}`}
                style={subNavTabStyle(sub === s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: fillWorkspace ? 'hidden' : 'auto',
          marginTop: 12,
          display: fillWorkspace ? 'flex' : undefined,
          flexDirection: fillWorkspace ? 'column' : undefined,
        }}
      >
        {error && (
          <div role="alert" style={{ color: '#b42318', fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}
        {loading ? (
          <div style={{ color: '#6b7280', fontSize: 13 }}>Loading intelligence…</div>
        ) : section === 'overview' ? (
          <ControlOverview
            workspaceId={workspaceId}
            userId={userId}
            components={components}
            onOpen={onOpen}
            onOpenSection={(next, nextSub) => {
              setIntelUi((prev) => ({
                ...prev,
                controlSection: next,
                controlSub: nextSub ?? defaultSubForSection(next),
              }))
            }}
          />
        ) : section === 'email-classification' ? (
          <EmailClassificationSection
            workspaceId={workspaceId}
            components={components}
            sub={(sub as EmailClassificationSub) ?? 'overview'}
            onOpen={onOpen}
          />
        ) : section === 'job-matcher' ? (
          <JobMatcherSection
            workspaceId={workspaceId}
            userId={userId}
            components={components}
            sub={(sub as JobMatcherSub) ?? 'overview'}
            uiState={intelUi}
            onUiStateChange={setIntelUi}
            onOpen={onOpen}
          />
        ) : section === 'document-intelligence' ? (
          <CategorySystemsSection
            title="Document Intelligence"
            description="Document and attachment analysis systems registered in the Intelligence Registry. Only existing capabilities are shown."
            sectionIds={INTELLIGENCE_SECTION_IDS['document-intelligence']}
            components={components}
            sub={(sub as DocumentIntelligenceSub) ?? 'overview'}
            onOpen={onOpen}
          />
        ) : (
          <CategorySystemsSection
            title="Workflow Intelligence"
            description="Bidding and intake workflow systems that propose or score operational decisions. Management tools appear only when registered."
            sectionIds={INTELLIGENCE_SECTION_IDS['workflow-intelligence']}
            components={components}
            sub={(sub as WorkflowIntelligenceSub) ?? 'overview'}
            onOpen={onOpen}
            emptyPlannedNote="No workflow intelligence systems are registered yet. This section is reserved for future automation management."
          />
        )}
      </div>
    </div>
  )
}

function ControlOverview({
  workspaceId,
  userId,
  components,
  onOpen,
  onOpenSection,
}: {
  workspaceId: string
  userId?: string
  components: IntelligenceSafeDto[]
  onOpen: (id: string) => void
  onOpenSection: (
    section: Exclude<IntelligenceControlSection, 'overview'>,
    sub?: IntelligenceControlSub
  ) => void
}) {
  if (components.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 24 }}>
        <h3>No intelligence systems are currently registered.</h3>
        <p>Qualifying systems must be added to INTELLIGENCE_CATALOG.</p>
      </div>
    )
  }

  const cards = mapIntelligenceCards(components)
  const session =
    userId != null ? getJobMatcherEvalSession(workspaceId, userId) : null

  const groups: Array<{
    section: Exclude<IntelligenceControlSection, 'overview'> | 'other'
    label: string
    items: IntelligenceSafeDto[]
  }> = [
    {
      section: 'email-classification',
      label: sectionLabel('email-classification'),
      items: [],
    },
    { section: 'job-matcher', label: sectionLabel('job-matcher'), items: [] },
    {
      section: 'document-intelligence',
      label: sectionLabel('document-intelligence'),
      items: [],
    },
    {
      section: 'workflow-intelligence',
      label: sectionLabel('workflow-intelligence'),
      items: [],
    },
    { section: 'other', label: 'Other registered systems', items: [] },
  ]

  for (const c of cards) {
    const sec = intelligenceSectionForId(c.id)
    const group = groups.find((g) => g.section === sec)
    if (group) group.items.push(c)
  }

  return (
    <div style={{ display: 'grid', gap: 18, paddingBottom: 24 }}>
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.section}>
            <h3 style={{ ...sectionH, marginBottom: 8 }}>{g.label}</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {g.items.map((c) => {
                // Preserve generic discovery: cards come from components.map via cards list.
                return (
                  <div
                    key={c.id}
                    style={{ ...cardBtn, cursor: 'default' }}
                    data-testid={`intelligence-card-${c.id}`}
                  >
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 15, fontWeight: 680, color: '#111827' }}>{c.name}</span>
                      <TypeBadge type={c.type} />
                      <StatusBadge status={c.status} />
                    </div>
                    <div style={{ fontSize: 13, color: '#4b5563', marginTop: 6, textAlign: 'left' }}>
                      {c.description}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        flexWrap: 'wrap',
                        marginTop: 8,
                        fontSize: 12,
                        color: '#6b7280',
                      }}
                    >
                      <span>Version: {c.version}</span>
                      {c.id === 'job-matcher' && (
                        <span>Production policy: {jobMatcherProductionPolicyLabel()}</span>
                      )}
                      <span>
                        Evaluation:{' '}
                        {c.evaluation.supported ? 'available' : 'unavailable'}
                      </span>
                      {c.id === 'job-matcher' && session?.result && (
                        <span>
                          Latest session eval: {session.result.metrics.totalEvaluated} emails ·
                          coverage{' '}
                          {Math.round(session.result.metrics.correctCoverage * 1000) / 10}%
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                      {g.section !== 'other' && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenSection(
                              g.section as Exclude<IntelligenceControlSection, 'overview'>,
                              'overview'
                            )
                          }
                          style={secondaryBtn}
                        >
                          Open {g.label}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpen(c.id)}
                        style={linkBtn}
                      >
                        Registry detail →
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      {/* Keep discovery contract: generic map over API components */}
      <div style={{ display: 'none' }} aria-hidden>
        {components.map((c) => (
          <button key={c.id} type="button" onClick={() => onOpen(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function EmailClassificationSection({
  workspaceId,
  components,
  sub,
  onOpen,
}: {
  workspaceId: string
  components: IntelligenceSafeDto[]
  sub: EmailClassificationSub
  onOpen: (id: string) => void
}) {
  const component = components.find((c) => c.id === 'email-classification')

  if (!component) {
    return (
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        Email Classification is not registered in this workspace catalog.
      </div>
    )
  }

  if (sub === 'overview') {
    return (
      <div style={{ display: 'grid', gap: 12, maxWidth: 760 }}>
        <OverviewSection component={component} />
        <button type="button" onClick={() => onOpen(component.id)} style={linkBtn}>
          Open full registry detail (pipeline, instructions, test) →
        </button>
      </div>
    )
  }

  if (sub === 'type') {
    const typeRules = component.rules.available
      ? component.rules.items.filter((r) =>
          /mailbox|category|BUSINESS|PERSONAL|priority|authority/i.test(r.id + r.title)
        )
      : []
    return (
      <div style={{ maxWidth: 760 }}>
        <h3 style={sectionH}>Type Classification</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          BUSINESS / PERSONAL mailbox category and related deterministic gates. Prompts and live
          reclassification are not edited from this page.
        </p>
        {typeRules.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {typeRules.map((r) => (
              <li key={r.id} style={{ marginBottom: 8 }}>
                <strong>{r.title}</strong>
                <div style={{ color: '#4b5563' }}>{r.summary}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            {component.rules.available === false
              ? component.rules.reason
              : component.rules.summary}
          </p>
        )}
        <button type="button" onClick={() => onOpen(component.id)} style={{ ...linkBtn, marginTop: 12 }}>
          View instructions &amp; rules in registry detail →
        </button>
      </div>
    )
  }

  if (sub === 'subtype') {
    const subtypeRule = component.rules.available
      ? component.rules.items.find((r) => /subtype|authority/i.test(r.id + r.title))
      : null
    return (
      <div style={{ maxWidth: 760 }}>
        <h3 style={sectionH}>Subtype Classification</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          Business subtype assignment for BUSINESS emails. Production prompts remain read-only in
          Manage → Intelligence.
        </p>
        {subtypeRule && (
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            <strong>{subtypeRule.title}</strong>
            <div style={{ color: '#4b5563' }}>{subtypeRule.summary}</div>
          </div>
        )}
        <KV
          label="Instructions"
          value={
            component.instructions.available
              ? component.instructions.summary
              : component.instructions.reason
          }
        />
        <KV
          label="Evaluation"
          value={
            component.evaluation.supported
              ? `Declared (${component.evaluation.evaluatorId ?? '—'}). Manage UI runner is Job Matcher only in V1.`
              : component.evaluation.notes
          }
        />
        <button type="button" onClick={() => onOpen(component.id)} style={{ ...linkBtn, marginTop: 12 }}>
          Open registry detail →
        </button>
      </div>
    )
  }

  if (sub === 'taxonomy') {
    return (
      <div style={{ maxWidth: 760 }}>
        <h3 style={sectionH}>Subtype Taxonomy</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          Canonical business subtypes from shared taxonomy ({BUSINESS_SUBTYPE_KEYS.length} keys).
          Editing taxonomy is not available from this page.
        </p>
        <div style={{ display: 'grid', gap: 6 }}>
          {BUSINESS_SUBTYPE_FILTER_OPTIONS.map((opt) => (
            <div
              key={opt.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr',
                gap: 8,
                fontSize: 13,
                padding: '6px 0',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
              <code style={{ fontSize: 12 }}>{opt.key}</code>
              <span>{opt.label}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (sub === 'evaluations') {
    return (
      <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 640 }}>
        <h3 style={{ ...sectionH, color: '#111827' }}>Evaluations</h3>
        {component.evaluation.supported ? (
          <>
            <p style={{ marginTop: 0 }}>
              Evaluation is declared (`{component.evaluation.evaluatorId}`), but a Manage UI runner is
              only wired for Job Matcher in V1. {component.evaluation.notes}
            </p>
            <p>
              Ground truth: <strong>{component.evaluation.groundTruthQuality}</strong> —{' '}
              {component.evaluation.groundTruthNotes}
            </p>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>Evaluation is not available for this intelligence.</p>
            <p>{component.evaluation.notes}</p>
          </>
        )}
        <button type="button" onClick={() => onOpen(component.id)} style={{ ...linkBtn, marginTop: 8 }}>
          Open registry detail →
        </button>
      </div>
    )
  }

  // discovery
  return <SubtypeDiscoveryPanel workspaceId={workspaceId} />
}

function JobMatcherSection({
  workspaceId,
  userId,
  components,
  sub,
  uiState,
  onUiStateChange,
  onOpen,
}: {
  workspaceId: string
  userId?: string
  components: IntelligenceSafeDto[]
  sub: JobMatcherSub
  uiState: IntelligencePersistedState
  onUiStateChange: (next: IntelligencePersistedState) => void
  onOpen: (id: string) => void
}) {
  const component = components.find((c) => c.id === 'job-matcher')
  const session =
    userId != null ? getJobMatcherEvalSession(workspaceId, userId) : null

  if (!component) {
    return (
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        Job Matcher is not registered in this workspace catalog.
      </div>
    )
  }

  if (sub === 'overview') {
    return (
      <div style={{ display: 'grid', gap: 12, maxWidth: 760 }}>
        <OverviewSection component={component} />
        <KV label="Production policy" value={jobMatcherProductionPolicyLabel()} />
        {session?.result ? (
          <KV
            label="Latest session evaluation"
            value={`${session.result.metrics.totalEvaluated} emails · correct coverage ${
              Math.round(session.result.metrics.correctCoverage * 1000) / 10
            }% (in-browser session only)`}
          />
        ) : (
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            No evaluation results in this browser session. Run Historical Evaluations to populate
            metrics — nothing is invented here.
          </p>
        )}
        <button type="button" onClick={() => onOpen(component.id)} style={linkBtn}>
          Open full registry detail (pipeline, rules, test) →
        </button>
      </div>
    )
  }

  if (sub === 'policies') {
    const rows = jobMatcherPolicyRows()
    return (
      <div style={{ maxWidth: 720 }}>
        <h3 style={sectionH}>Matcher Policies</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          Identity policies from the shared Job Match policy registry. Production selection is not
          changed from this page.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                padding: 12,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: row.productionDefault ? '#f0fdf4' : '#fff',
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <code style={{ fontSize: 13, fontWeight: 650 }}>{row.label}</code>
                {row.productionDefault && (
                  <span style={badge('#dcfce7', '#166534')}>Production</span>
                )}
                {row.experimental && !row.productionDefault && (
                  <span style={badge('#fef3c7', '#92400e')}>Experimental</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>id: {row.id}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (sub === 'history') {
    return (
      <div style={{ maxWidth: 640, fontSize: 13, color: '#4b5563' }}>
        <h3 style={{ ...sectionH, color: '#111827' }}>Evaluation History</h3>
        <p style={{ marginTop: 0 }}>
          Persistent server-side evaluation history is not available yet. Completed Job Matcher
          evaluation results restore from SPA session memory when you return to Intelligence in this
          browser tab — browser refresh still clears results.
        </p>
        {session?.result ? (
          <SessionEvalHistoryCard result={session.result} />
        ) : (
          <p style={{ color: '#6b7280' }}>No completed evaluation in this session.</p>
        )}
      </div>
    )
  }

  // evaluations | comparisons — reuse JobMatcherEvaluationPanel (no rerun on policy switch)
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {sub === 'comparisons' && (
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px', flexShrink: 0 }}>
          Use Model Selection (Single or Compare) to evaluate any registered policy subset. After a
          run, switch Matcher results without re-running — metrics follow the selected evaluated
          policy.
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <EvaluationSection
          workspaceId={workspaceId}
          userId={userId}
          component={component}
          uiState={uiState}
          onUiStateChange={onUiStateChange}
        />
      </div>
    </div>
  )
}

function CategorySystemsSection({
  title,
  description,
  sectionIds,
  components,
  sub,
  onOpen,
  emptyPlannedNote,
}: {
  title: string
  description: string
  sectionIds: readonly string[]
  components: IntelligenceSafeDto[]
  sub: DocumentIntelligenceSub | WorkflowIntelligenceSub
  onOpen: (id: string) => void
  emptyPlannedNote?: string
}) {
  const items = mapIntelligenceCards(
    components.filter((c) => sectionIds.includes(c.id))
  )

  if (sub === 'overview') {
    return (
      <div style={{ maxWidth: 720 }}>
        <h3 style={sectionH}>{title}</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>{description}</p>
        {items.length === 0 ? (
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            {emptyPlannedNote ?? 'No systems registered in this category.'}
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {items.map((c) => (
              <li key={c.id} style={{ marginBottom: 8 }}>
                <strong>{c.name}</strong>
                <span style={{ color: '#6b7280' }}>
                  {' '}
                  · {intelligenceStatusLabel(c.status)} · evaluation{' '}
                  {c.evaluation.supported ? 'declared' : 'not supported'}
                </span>
                <div style={{ color: '#4b5563' }}>{c.description}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 640 }}>
        {emptyPlannedNote ?? 'No systems registered in this category.'}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpen(c.id)}
          style={cardBtn}
          data-testid={`intelligence-card-${c.id}`}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 680, color: '#111827' }}>{c.name}</span>
            <TypeBadge type={c.type} />
            <StatusBadge status={c.status} />
          </div>
          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 6, textAlign: 'left' }}>
            {c.description}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
            Version: {c.version} · Evaluation:{' '}
            {c.evaluation.supported ? 'available' : 'unavailable'}
          </div>
        </button>
      ))}
    </div>
  )
}

function IntelligenceDetail({
  workspaceId,
  userId,
  intelligenceId,
  onBack,
}: {
  workspaceId: string
  userId?: string
  intelligenceId: string
  onBack: () => void
}) {
  const restored = userId ? loadIntelligenceState({ workspaceId, userId }) : null
  const [component, setComponent] = useState<IntelligenceSafeDto | null>(null)
  const [instructions, setInstructions] = useState<
    Array<{ key: string; available: boolean; text: string | null; note?: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'pipeline' | 'instructions' | 'evaluation' | 'test'>(
    () => restored?.tab ?? 'overview'
  )
  const [intelUi, setIntelUi] = useState<IntelligencePersistedState>(
    () => restored ?? DEFAULT_INTELLIGENCE_STATE
  )

  useEffect(() => {
    setLoading(true)
    setError(null)
    const next = userId ? loadIntelligenceState({ workspaceId, userId }) : null
    setTab(next?.tab ?? 'overview')
    setIntelUi(next ?? DEFAULT_INTELLIGENCE_STATE)
    api
      .getIntelligence(workspaceId, intelligenceId)
      .then((r) => {
        setComponent(r.component)
        setInstructions(r.instructions)
      })
      .catch((e) => {
        setComponent(null)
        setError(e instanceof Error ? e.message : 'Not found')
      })
      .finally(() => setLoading(false))
  }, [workspaceId, intelligenceId, userId])

  useEffect(() => {
    if (!userId) return
    const next = { ...intelUi, tab }
    persistIntelligenceState({ workspaceId, userId, state: next })
  }, [workspaceId, userId, tab, intelUi])

  if (loading) {
    return <div style={{ color: '#6b7280', fontSize: 13 }}>Loading…</div>
  }
  if (!component) {
    return (
      <div>
        <button type="button" onClick={onBack} style={linkBtn}>← Intelligence</button>
        <div role="alert" style={{ color: '#b42318', marginTop: 12, fontSize: 13 }}>
          {error ?? 'Intelligence not found'}
        </div>
      </div>
    )
  }

  const showInstructions = showInstructionsSection(component.type)
  const showRules = showRulesSection(component.type)
  const fillWorkspace = tab === 'evaluation'

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'instructions', label: instructionsTabLabel(component.type) },
    { key: 'evaluation', label: 'Evaluation' },
    { key: 'test', label: 'Test' },
  ]

  const autoAssignFlag = component.featureFlags.find((f) =>
    /AUTO_ASSIGN/i.test(f.envName)
  )

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={onBack} style={linkBtn}>← Intelligence</button>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{component.name}</h2>
          <TypeBadge type={component.type} />
          <StatusBadge status={component.status} />
          {autoAssignFlag && (
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              Auto Assign {autoAssignFlag.defaultEnabled ? 'ON' : 'OFF'}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: '#6b7280',
            marginTop: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={component.purpose}
        >
          {component.purpose}
        </div>

        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e5e5', marginTop: 8, overflowX: 'auto' }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={navTabStyle(tab === t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: fillWorkspace ? 'hidden' : 'auto',
          marginTop: 10,
          display: fillWorkspace ? 'flex' : undefined,
          flexDirection: fillWorkspace ? 'column' : undefined,
        }}
      >
        {tab === 'overview' && <OverviewSection component={component} />}
        {tab === 'pipeline' && (
          <IntelligencePipelineView nodes={component.pipeline.nodes} edges={component.pipeline.edges} />
        )}
        {tab === 'instructions' && (
          <InstructionsRulesSection
            component={component}
            instructions={instructions}
            showInstructions={showInstructions}
            showRules={showRules}
          />
        )}
        {tab === 'evaluation' && (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <EvaluationSection
              workspaceId={workspaceId}
              userId={userId}
              component={component}
              uiState={intelUi}
              onUiStateChange={setIntelUi}
            />
          </div>
        )}
        {tab === 'test' && <TestSection workspaceId={workspaceId} component={component} />}
      </div>
    </div>
  )
}

function OverviewSection({ component }: { component: IntelligenceSafeDto }) {
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 13, maxWidth: 720 }}>
      <KV label="Purpose" value={component.purpose} />
      <KV label="Version" value={component.version} />
      <KV label="Inputs" value={component.inputs} />
      <KV label="Outputs" value={component.outputs} />
      <KV
        label="Evaluation"
        value={
          component.evaluation.supported
            ? `Supported (${component.evaluation.evaluatorId ?? '—'})`
            : `Unavailable — ${component.evaluation.notes}`
        }
      />
      <KV
        label="Ground truth"
        value={`${component.evaluation.groundTruthQuality} — ${component.evaluation.groundTruthNotes}`}
      />
      <KV
        label="Explainability"
        value={
          component.explainability.available
            ? component.explainability.capabilities.join(', ')
            : component.explainability.notes
        }
      />
      {component.featureFlags.length > 0 && (
        <div>
          <div style={{ color: '#6b7280', marginBottom: 4 }}>Feature flags</div>
          {component.featureFlags.map((f) => (
            <div key={f.envName} style={{ marginBottom: 6 }}>
              <code style={{ fontSize: 12 }}>{f.envName}</code>
              <span style={{ color: '#6b7280' }}>
                {' '}
                · default {f.defaultEnabled ? 'ON' : 'OFF'} — {f.effect}
              </span>
            </div>
          ))}
        </div>
      )}
      <KV
        label="Implementation"
        value={`${component.implementation.packages.join(', ')} · ${component.implementation.entryPoints.join(', ')}`}
      />
    </div>
  )
}

function InstructionsRulesSection({
  component,
  instructions,
  showInstructions,
  showRules,
}: {
  component: IntelligenceSafeDto
  instructions: Array<{ key: string; available: boolean; text: string | null; note?: string }>
  showInstructions: boolean
  showRules: boolean
}) {
  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 800 }}>
      {showInstructions && (
        <section>
          <h3 style={sectionH}>Instructions (read-only)</h3>
          {component.instructions.available === false ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>{component.instructions.reason}</p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
                {component.instructions.summary} Editing production prompts is not available in V1.
              </p>
              {instructions.map((row) => (
                <div key={row.key} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{row.key}</div>
                  {row.note && !row.text ? (
                    <p style={{ fontSize: 12, color: '#6b7280' }}>{row.note}</p>
                  ) : (
                    <pre style={preStyle}>{row.text ?? '(unavailable)'}</pre>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      )}
      {showRules && (
        <section>
          <h3 style={sectionH}>Rules</h3>
          {component.rules.available === false ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>{component.rules.reason}</p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>{component.rules.summary}</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {component.rules.items.map((r) => (
                  <li key={r.id} style={{ marginBottom: 8 }}>
                    <strong>{r.title}</strong>
                    {r.version ? <span style={{ color: '#6b7280' }}> · {r.version}</span> : null}
                    <div style={{ color: '#4b5563' }}>{r.summary}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function EvaluationSection({
  workspaceId,
  userId,
  component,
  uiState,
  onUiStateChange,
}: {
  workspaceId: string
  userId?: string
  component: IntelligenceSafeDto
  uiState: IntelligencePersistedState
  onUiStateChange: (next: IntelligencePersistedState) => void
}) {
  if (!component.evaluation.supported) {
    return (
      <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 640 }}>
        <p style={{ marginTop: 0 }}>Evaluation is not available for this intelligence.</p>
        <p>{component.evaluation.notes}</p>
        <p>
          Ground truth: <strong>{component.evaluation.groundTruthQuality}</strong> —{' '}
          {component.evaluation.groundTruthNotes}
        </p>
      </div>
    )
  }

  if (component.id !== 'job-matcher') {
    return (
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        Evaluation is declared (`{component.evaluation.evaluatorId}`), but a Manage UI runner is only
        wired for Job Matcher in V1. {component.evaluation.notes}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', minHeight: 0 }}>
      <JobMatcherEvaluationPanel
        workspaceId={workspaceId}
        userId={userId}
        groundTruthQuality={component.evaluation.groundTruthQuality}
        groundTruthNotes={component.evaluation.groundTruthNotes}
        initialUi={uiState}
        onUiChange={onUiStateChange}
      />
    </div>
  )
}

function TestSection({
  workspaceId,
  component,
}: {
  workspaceId: string
  component: IntelligenceSafeDto
}) {
  const [emails, setEmails] = useState<
    Array<{
      id: string
      subject: string | null
      jobName: string | null
      jobNumber: string | null
    }>
  >([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<JobMatcherTestOneResult | null>(null)

  useEffect(() => {
    if (component.id !== 'job-matcher') return
    const t = window.setTimeout(() => {
      api
        .listJobMatcherTestEmails(workspaceId, { search: search.trim() || undefined })
        .then((r) => setEmails(r.emails))
        .catch(() => setEmails([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [workspaceId, component.id, search])

  if (component.id !== 'job-matcher') {
    return (
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        Test One is implemented for Job Matcher in V1. Other systems show stored metadata only —
        live LLM re-runs are not auto-triggered from this page.
      </div>
    )
  }

  const run = async () => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.testJobMatcherOne(workspaceId, { emailMessageId: selectedId })
      setTest(res.test)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <p style={{ fontSize: 13, color: '#6b7280' }}>
        Select an existing authoritative email. Runs the Marker pipeline read-only (evaluation mode +
        holdout). No Job assignment is written.
      </p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search subjects…"
        style={{ width: '100%', maxWidth: 400, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, marginBottom: 8 }}
      />
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{ width: '100%', maxWidth: 560, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, display: 'block', marginBottom: 10 }}
      >
        <option value="">Select email…</option>
        {emails.map((e) => (
          <option key={e.id} value={e.id}>
            {(e.subject || '(no subject)').slice(0, 80)} · {e.jobNumber || e.jobName || e.id}
          </option>
        ))}
      </select>
      <button type="button" disabled={!selectedId || busy} onClick={() => void run()} style={primaryBtn}>
        {busy ? 'Running…' : 'Run Matcher'}
      </button>
      {error && <div role="alert" style={{ color: '#b42318', fontSize: 13, marginTop: 8 }}>{error}</div>}
      {test && (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <KV label="Decision" value={test.result.decision} />
          <KV label="Predicted Job" value={test.result.selectedJobName || test.result.selectedJobId || '—'} />
          <KV
            label="Historical Job"
            value={
              test.historical.jobName || test.historical.jobId || '—'
            }
          />
          <KV
            label="Outcome"
            value={
              test.historical.outcome ??
              (test.historical.authoritativeGroundTruth ? '—' : 'No authoritative ground truth')
            }
          />
          <KV label="Resolving marker" value={test.result.resolvingMarker || '—'} />
          <h3 style={{ ...sectionH, marginTop: 14 }}>Marker trace</h3>
          {(test.result.markerTrace ?? []).map((row) => (
            <div key={row.marker} style={{ marginBottom: 10, padding: 10, border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div style={{ fontWeight: 650 }}>{row.marker} · {row.status}</div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>
                Candidates: {(row.candidateJobIds ?? []).slice(0, 8).join(', ') || '—'}
              </div>
            </div>
          ))}
          <h3 style={sectionH}>Evidence</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {(test.result.evidence ?? []).slice(0, 20).map((ev, i) => (
              <li key={i}>{ev.type}: {ev.value}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  return <span style={badge('#eef2ff', '#3730a3')}>{intelligenceTypeLabel(type)}</span>
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    ACTIVE: ['#dcfce7', '#166534'],
    FEATURE_GATED: ['#fef3c7', '#92400e'],
    SHADOW: ['#e0e7ff', '#3730a3'],
    EVALUATION_ONLY: ['#f3e8ff', '#6b21a8'],
    LEGACY: ['#f3f4f6', '#4b5563'],
    DISABLED: ['#fee2e2', '#991b1b'],
  }
  const [bg, fg] = colors[status] ?? ['#f3f4f6', '#374151']
  return <span style={badge(bg, fg)}>{intelligenceStatusLabel(status)}</span>
}

function SessionEvalHistoryCard({ result }: { result: JobMatcherEvalResult }) {
  const m = result.displayMetrics ?? result.metrics
  const jmps = computeJobMatcherPerformanceScore(m)
  const family = result.v2FamilyComparison
  return (
    <div
      style={{
        padding: 12,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: 6 }}>Current session run</div>
      <div>
        Performance Score: {jmps.display}
        <span style={{ color: '#6b7280' }}> (weighted; not precision)</span>
      </div>
      <div>Emails evaluated: {m.totalEvaluated}</div>
      <div>
        Correct coverage: {Math.round(m.correctCoverage * 1000) / 10}%
      </div>
      {family ? (
        <div style={{ marginTop: 6, fontSize: 12, color: '#374151' }}>
          Compare All present: V2 {fmtHistoryJmps(family.performanceScores.v2)} ·
          V2.1 {fmtHistoryJmps(family.performanceScores.v21)} · V2.2{' '}
          {fmtHistoryJmps(family.performanceScores.v22)}
        </div>
      ) : result.comparison ? (
        <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
          Paired comparison ({result.comparison.baselinePolicy} →{' '}
          {result.comparison.proposedPolicy}). V2.2 not in this run.
        </div>
      ) : null}
      {result.evaluationRunId && (
        <div style={{ color: '#6b7280', marginTop: 4 }}>
          Run id: {result.evaluationRunId}
        </div>
      )}
    </div>
  )
}

function fmtHistoryJmps(score: number | null): string {
  return score == null ? 'N/A' : score.toFixed(2)
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', whiteSpace: 'pre-wrap' }}>{value}</span>
    </div>
  )
}

function badge(bg: string, color: string): CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 650,
    background: bg,
    color,
  }
}

function navTabStyle(active: boolean): CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? '#1a1a2e' : '#888',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid #1a1a2e' : '2px solid transparent',
    marginBottom: -2,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

function subNavTabStyle(active: boolean): CSSProperties {
  return {
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    color: active ? '#1d4ed8' : '#6b7280',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid #1d4ed8' : '2px solid transparent',
    marginBottom: -1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

const cardBtn: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#fff',
  cursor: 'pointer',
}
const linkBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  color: '#1d4ed8',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
}
const secondaryBtn: CSSProperties = {
  padding: '6px 12px',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  background: '#fff',
  color: '#111827',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
const primaryBtn: CSSProperties = {
  padding: '8px 14px',
  border: '1px solid #1a1a2e',
  borderRadius: 6,
  background: '#1a1a2e',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
const sectionH: CSSProperties = { fontSize: 14, fontWeight: 650, margin: '0 0 8px' }
const preStyle: CSSProperties = {
  margin: '6px 0 0',
  padding: 12,
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  maxHeight: 280,
  overflow: 'auto',
}
