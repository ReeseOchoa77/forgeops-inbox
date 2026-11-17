/**
 * Admin-only restore of historical JobMatcherEvalGroundTruthCorrection overlays.
 * Distinct from temporary Mark Correct (session-only) overrides.
 */
import { useState, type CSSProperties } from 'react'
import {
  api,
  type JobMatcherEvalGroundTruthRestorationPreview,
} from '../api'

type RestoreScope = 'CURRENT_EVALUATION' | 'TENANT_ALL'

export function JobMatcherEvalRestorePanel(props: {
  workspaceId: string
  evaluationRunId: string | null
}) {
  const [scope, setScope] = useState<RestoreScope>(
    props.evaluationRunId ? 'CURRENT_EVALUATION' : 'TENANT_ALL'
  )
  const [preview, setPreview] =
    useState<JobMatcherEvalGroundTruthRestorationPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const canPreviewCurrent =
    scope !== 'CURRENT_EVALUATION' || Boolean(props.evaluationRunId)

  const loadPreview = async () => {
    setError(null)
    setResultMsg(null)
    setConfirmOpen(false)
    if (scope === 'CURRENT_EVALUATION' && !props.evaluationRunId) {
      setError('Run an evaluation first to restore the current evaluation scope.')
      setPreview(null)
      return
    }
    setBusy(true)
    try {
      const res = await api.previewJobMatcherEvalGroundTruthRestoration(
        props.workspaceId,
        {
          scope,
          ...(props.evaluationRunId && scope === 'CURRENT_EVALUATION'
            ? { evaluationRunId: props.evaluationRunId }
            : {}),
        }
      )
      setPreview(res.preview)
    } catch (e) {
      setPreview(null)
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  const runRestore = async () => {
    if (!preview?.restorationNecessary) return
    if (scope === 'CURRENT_EVALUATION' && !props.evaluationRunId) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.restoreJobMatcherEvalGroundTruthCorrections(
        props.workspaceId,
        {
          scope,
          confirm: true,
          ...(props.evaluationRunId && scope === 'CURRENT_EVALUATION'
            ? { evaluationRunId: props.evaluationRunId }
            : {}),
        }
      )
      setConfirmOpen(false)
      setResultMsg(
        res.restoration.alreadyClean
          ? 'No ACTIVE overlays remained (already restored).'
          : `Restored ${res.restoration.reversedCount} overlay${
              res.restoration.reversedCount === 1 ? '' : 's'
            } across ${res.restoration.affectedEmailCount} email${
              res.restoration.affectedEmailCount === 1 ? '' : 's'
            }. Historical snapshots and production assignments were not changed.`
      )
      // Refresh preview after restore.
      const refreshed = await api.previewJobMatcherEvalGroundTruthRestoration(
        props.workspaceId,
        {
          scope,
          ...(props.evaluationRunId && scope === 'CURRENT_EVALUATION'
            ? { evaluationRunId: props.evaluationRunId }
            : {}),
        }
      )
      setPreview(refreshed.preview)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="job-matcher-restore-panel"
      style={{
        marginTop: 10,
        padding: '10px 12px',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: 4 }}>
        Restore original evaluation data
      </div>
      <div style={{ color: '#6b7280', marginBottom: 8 }}>
        Reverse historical database correction overlays (ACTIVE → REVERSED). Does
        not clear temporary Mark Correct overrides, rewrite evaluation snapshots,
        or change production Job assignments. Admin only.
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input
            type="radio"
            name="gt-restore-scope"
            checked={scope === 'CURRENT_EVALUATION'}
            disabled={!props.evaluationRunId}
            onChange={() => {
              setScope('CURRENT_EVALUATION')
              setPreview(null)
              setResultMsg(null)
            }}
          />
          Current evaluation
        </label>
        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input
            type="radio"
            name="gt-restore-scope"
            checked={scope === 'TENANT_ALL'}
            onChange={() => {
              setScope('TENANT_ALL')
              setPreview(null)
              setResultMsg(null)
            }}
          />
          All historical (this workspace)
        </label>
        <button
          type="button"
          data-testid="job-matcher-restore-preview"
          disabled={busy || !canPreviewCurrent}
          onClick={() => void loadPreview()}
          style={btn}
        >
          {busy ? 'Working…' : 'Preview restoration'}
        </button>
      </div>
      {error ? (
        <div role="alert" style={{ color: '#b91c1c', marginBottom: 6 }}>
          {error}
        </div>
      ) : null}
      {resultMsg ? (
        <div
          data-testid="job-matcher-restore-result"
          style={{ color: '#065f46', marginBottom: 6 }}
        >
          {resultMsg}
        </div>
      ) : null}
      {preview ? (
        <div data-testid="job-matcher-restore-preview-result">
          <div style={{ marginBottom: 6 }}>{preview.message}</div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 14px',
              color: '#4b5563',
              marginBottom: 8,
            }}
          >
            <span>ACTIVE: {preview.activeCount}</span>
            <span>REVERSED (history): {preview.reversedCount}</span>
            <span>Emails: {preview.affectedEmailCount}</span>
            <span>Eval runs: {preview.affectedEvaluationRunCount}</span>
          </div>
          {preview.items.length > 0 ? (
            <div style={{ overflowX: 'auto', maxHeight: 180, marginBottom: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={th}>Email</th>
                    <th style={th}>Original GT</th>
                    <th style={th}>Corrected GT</th>
                    <th style={th}>Status</th>
                    <th style={th}>Source run</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((item) => (
                    <tr key={item.id}>
                      <td style={td}>{item.emailMessageId.slice(0, 12)}…</td>
                      <td style={td}>{item.originalGroundTruthJobLabel}</td>
                      <td style={td}>{item.correctedGroundTruthJobLabel}</td>
                      <td style={td}>{item.verificationStatus}</td>
                      <td style={td}>
                        {item.sourceEvaluationRunId
                          ? `${item.sourceEvaluationRunId.slice(0, 8)}…`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.truncated ? (
                <div style={{ color: '#6b7280', marginTop: 4 }}>
                  Showing first {preview.items.length} of {preview.activeCount}{' '}
                  ACTIVE rows.
                </div>
              ) : null}
            </div>
          ) : null}
          {preview.restorationNecessary ? (
            confirmOpen ? (
              <div
                data-testid="job-matcher-restore-confirm"
                style={{
                  border: '1px solid #f59e0b',
                  background: '#fffbeb',
                  borderRadius: 6,
                  padding: 10,
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  Confirm reversing {preview.activeCount} ACTIVE overlay
                  {preview.activeCount === 1 ? '' : 's'}? Records are preserved as
                  REVERSED. Snapshots and production assignments stay unchanged.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    data-testid="job-matcher-restore-confirm-yes"
                    disabled={busy}
                    onClick={() => void runRestore()}
                    style={{ ...btn, background: '#b45309', color: '#fff', borderColor: '#b45309' }}
                  >
                    Confirm restore
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmOpen(false)}
                    style={btn}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid="job-matcher-restore-start"
                disabled={busy}
                onClick={() => setConfirmOpen(true)}
                style={btn}
              >
                Restore original evaluation data…
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const btn: CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 12,
  cursor: 'pointer',
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '3px 6px',
  borderBottom: '1px solid #e5e7eb',
  color: '#6b7280',
  fontWeight: 650,
}

const td: CSSProperties = {
  padding: '3px 6px',
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
}
