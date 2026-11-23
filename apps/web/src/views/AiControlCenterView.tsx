import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  api,
  type AiControlCenterDto,
  type AiControlSubsystemState,
} from '../api'

type DraftState = Record<string, AiControlSubsystemState>

const cardStyle: CSSProperties = {
  border: '1px solid #d8dde6',
  borderRadius: 10,
  padding: 16,
  background: '#fff',
  display: 'grid',
  gap: 12,
}

export function AiControlCenterView({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dto, setDto] = useState<AiControlCenterDto | null>(null)
  const [draft, setDraft] = useState<DraftState>({})
  const [confirmOpen, setConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getAiControlCenter(workspaceId)
      setDto(data)
      setDraft({ ...data.config.subsystems })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load AI Control Center')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => {
    if (!dto) return false
    for (const id of Object.keys(dto.config.subsystems)) {
      const a = dto.config.subsystems[id]
      const b = draft[id]
      if (!b) return true
      if (a.enabled !== b.enabled || a.productionModelId !== b.productionModelId) return true
    }
    return false
  }, [dto, draft])

  const changes = useMemo(() => {
    if (!dto) return [] as Array<{ id: string; name: string; from: string; to: string }>
    const out: Array<{ id: string; name: string; from: string; to: string }> = []
    for (const def of dto.definitions) {
      const prev = dto.config.subsystems[def.id]
      const next = draft[def.id]
      if (!prev || !next) continue
      if (prev.enabled !== next.enabled || prev.productionModelId !== next.productionModelId) {
        out.push({
          id: def.id,
          name: def.name,
          from: `${prev.enabled ? 'ON' : 'OFF'} · ${prev.productionModelId}`,
          to: `${next.enabled ? 'ON' : 'OFF'} · ${next.productionModelId}`,
        })
      }
    }
    return out
  }, [dto, draft])

  async function saveConfirmed() {
    if (!dto) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const patch: Record<string, Partial<AiControlSubsystemState>> = {}
      for (const change of changes) {
        patch[change.id] = draft[change.id]
      }
      const result = await api.updateAiControlCenter(workspaceId, {
        confirm: true,
        expectedConfigVersion: dto.config.configVersion,
        subsystems: patch,
      })
      setDto((prev) =>
        prev
          ? {
              ...prev,
              config: result.config,
            }
          : prev
      )
      setDraft({ ...result.config.subsystems })
      setConfirmOpen(false)
      setSuccess('Production AI configuration saved. Changes apply to future processing only.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p style={{ color: '#667', padding: 16 }}>Loading AI Control Center…</p>
  }

  if (!dto) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: '#b00020' }}>{error ?? 'Unable to load configuration'}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div data-testid="ai-control-center" style={{ padding: 16, display: 'grid', gap: 16, maxWidth: 960 }}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>AI Control Center</h1>
        <p style={{ margin: 0, color: '#556', lineHeight: 1.45 }}>
          Configure which production AI subsystems are active for this workspace. Changes require
          confirmation and apply only to future eligible processing — historical records are not
          rewritten.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: '#778' }}>
          Config version {dto.config.configVersion}
          {dto.config.updatedAt ? ` · Updated ${new Date(dto.config.updatedAt).toLocaleString()}` : ''}
          {dirty ? ' · Unsaved changes' : ''}
        </p>
      </header>

      {error && (
        <div role="alert" style={{ color: '#b00020', background: '#fff5f5', padding: 10, borderRadius: 8 }}>
          {error}
        </div>
      )}
      {success && (
        <div role="status" style={{ color: '#0a6', background: '#f0fff6', padding: 10, borderRadius: 8 }}>
          {success}
        </div>
      )}

      {dto.definitions.map((def) => {
        const state = draft[def.id] ?? dto.config.subsystems[def.id]
        const selectableModels = def.models.filter((m) => m.selectable && m.status !== 'retired')
        return (
          <section key={def.id} style={cardStyle} data-testid={`ai-control-${def.id}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <strong style={{ fontSize: 16 }}>{def.name}</strong>
                <span style={{ color: '#556', fontSize: 14, lineHeight: 1.4 }}>{def.description}</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={state?.enabled ?? false}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      [def.id]: {
                        enabled: e.target.checked,
                        productionModelId:
                          prev[def.id]?.productionModelId ??
                          dto.config.subsystems[def.id].productionModelId,
                      },
                    }))
                  }
                />
                {state?.enabled ? 'Enabled' : 'Disabled'}
              </label>
            </div>

            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              Production model
              <select
                value={state?.productionModelId ?? ''}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    [def.id]: {
                      enabled: prev[def.id]?.enabled ?? dto.config.subsystems[def.id].enabled,
                      productionModelId: e.target.value,
                    },
                  }))
                }
                disabled={selectableModels.length === 0}
              >
                {selectableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.status})
                  </option>
                ))}
              </select>
            </label>

            <p style={{ margin: 0, fontSize: 13, color: '#667' }}>
              When disabled: {def.disableBehavior}
            </p>
            {def.dependencies.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, color: '#775500', fontSize: 13 }}>
                {def.dependencies.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            setSuccess(null)
            setConfirmOpen(true)
          }}
        >
          Review &amp; save production changes
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft({ ...dto.config.subsystems })
            setError(null)
            setSuccess(null)
          }}
        >
          Discard
        </button>
      </div>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 50,
            padding: 16,
          }}
        >
          <div style={{ ...cardStyle, maxWidth: 520, width: '100%' }}>
            <strong>Confirm production AI changes</strong>
            <p style={{ margin: 0, color: '#556', fontSize: 14 }}>
              These settings control live processing for this workspace. Historical emails, Job
              assignments, evaluation ground truth, and existing intelligence are not rewritten.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {changes.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong>: {c.from} → {c.to}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" disabled={saving} onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" disabled={saving || changes.length === 0} onClick={() => void saveConfirmed()}>
                {saving ? 'Saving…' : 'Confirm & save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
