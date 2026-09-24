import { useState, type CSSProperties } from "react"
import { api, type JobFabricationItem } from "../api"
import { formatHoursNumber, formatQuantity, totalEstimatedHours } from "../job-overview-format"

type Draft = { name: string; quantity: string; hours: string }

const emptyDraft = (): Draft => ({ name: "", quantity: "1", hours: "" })

export function JobFabricationScope({
  workspaceId,
  jobId,
  items,
  canEdit,
  isPhone,
  onUpdated,
}: {
  workspaceId: string
  jobId: string
  items: JobFabricationItem[]
  canEdit: boolean
  isPhone: boolean
  onUpdated: (items: JobFabricationItem[], estimatedHours: number) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pieceCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const hours = totalEstimatedHours(items)

  const apply = (next: { items: JobFabricationItem[]; estimatedHours: number }) => {
    onUpdated(next.items, next.estimatedHours)
  }

  const saveNew = async () => {
    const quantity = Number(draft.quantity)
    const estimatedHoursPerPiece = Number(draft.hours)
    if (!draft.name.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(estimatedHoursPerPiece) || estimatedHoursPerPiece < 0) {
      setError("Enter a name, quantity, and hours per piece.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await api.createJobFabricationItem(workspaceId, jobId, {
        name: draft.name.trim(),
        quantity,
        estimatedHoursPerPiece,
      })
      apply(next)
      setDraft(emptyDraft())
      setAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add item")
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (itemId: string) => {
    const quantity = Number(editDraft.quantity)
    const estimatedHoursPerPiece = Number(editDraft.hours)
    if (!editDraft.name.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(estimatedHoursPerPiece) || estimatedHoursPerPiece < 0) {
      setError("Enter a name, quantity, and hours per piece.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await api.updateJobFabricationItem(workspaceId, jobId, itemId, {
        name: editDraft.name.trim(),
        quantity,
        estimatedHoursPerPiece,
      })
      apply(next)
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save item")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (itemId: string) => {
    setBusy(true)
    setError(null)
    try {
      const next = await api.deleteJobFabricationItem(workspaceId, jobId, itemId)
      apply(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove item")
    } finally {
      setBusy(false)
    }
  }

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const ids = items.map((item) => item.id)
    const [moved] = ids.splice(index, 1)
    if (!moved) return
    ids.splice(target, 0, moved)
    setBusy(true)
    setError(null)
    try {
      const next = await api.reorderJobFabricationItems(workspaceId, jobId, ids)
      apply(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder items")
    } finally {
      setBusy(false)
    }
  }

  const draftFields = (value: Draft, onChange: (next: Draft) => void) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input
        aria-label="Item name"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        placeholder="Item"
        style={fieldStyle}
      />
      <input
        aria-label="Quantity"
        value={value.quantity}
        onChange={(e) => onChange({ ...value, quantity: e.target.value })}
        inputMode="decimal"
        style={{ ...fieldStyle, width: 80 }}
      />
      <input
        aria-label="Hours per piece"
        value={value.hours}
        onChange={(e) => onChange({ ...value, hours: e.target.value })}
        inputMode="decimal"
        placeholder="Hrs / piece"
        style={{ ...fieldStyle, width: 110 }}
      />
    </div>
  )

  return (
    <section style={{ marginTop: 20, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: isPhone ? 12 : 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: "#374151" }}>FABRICATION SCOPE</div>
        {canEdit && !adding && (
          <button type="button" onClick={() => { setAdding(true); setError(null) }} style={addButton}>
            + Add Item
          </button>
        )}
      </div>

      {items.length === 0 && !adding && (
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          No fabrication items have been added.
          {canEdit && (
            <button type="button" onClick={() => setAdding(true)} style={{ ...addButton, marginLeft: 8 }}>
              Add Fabrication Item
            </button>
          )}
        </div>
      )}

      {adding && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
          {draftFields(draft, setDraft)}
          <button type="button" onClick={() => void saveNew()} disabled={busy} style={addButton}>Save</button>
          <button type="button" onClick={() => { setAdding(false); setDraft(emptyDraft()) }} style={quietButton}>Cancel</button>
        </div>
      )}

      {items.length > 0 && (isPhone ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item, index) => (
            <div key={item.id} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 10 }}>
              {editingId === item.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {draftFields(editDraft, setEditDraft)}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => void saveEdit(item.id)} disabled={busy} style={addButton}>Save</button>
                    <button type="button" onClick={() => setEditingId(null)} style={quietButton}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>
                    Qty {formatQuantity(item.quantity)} · {formatHoursNumber(item.estimatedHoursPerPiece)} hrs/piece · {formatHoursNumber(item.totalHours)} total hrs
                  </div>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={() => { setEditingId(item.id); setEditDraft({ name: item.name, quantity: String(item.quantity), hours: String(item.estimatedHoursPerPiece) }) }} style={quietButton}>Edit</button>
                      <button type="button" onClick={() => void remove(item.id)} style={quietButton}>Remove</button>
                      <button type="button" onClick={() => void move(index, -1)} disabled={index === 0 || busy} style={quietButton}>Up</button>
                      <button type="button" onClick={() => void move(index, 1)} disabled={index === items.length - 1 || busy} style={quietButton}>Down</button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left", color: "#6b7280" }}>
                <th style={th}>Item</th>
                <th style={{ ...th, textAlign: "right" }}>Qty</th>
                <th style={{ ...th, textAlign: "right" }}>Hrs / Piece</th>
                <th style={{ ...th, textAlign: "right" }}>Total Hrs</th>
                {canEdit && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  {editingId === item.id ? (
                    <td colSpan={canEdit ? 5 : 4} style={{ padding: "8px 0" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        {draftFields(editDraft, setEditDraft)}
                        <button type="button" onClick={() => void saveEdit(item.id)} disabled={busy} style={addButton}>Save</button>
                        <button type="button" onClick={() => setEditingId(null)} style={quietButton}>Cancel</button>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td style={td}>{item.name}</td>
                      <td style={{ ...td, textAlign: "right" }}>{formatQuantity(item.quantity)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{formatHoursNumber(item.estimatedHoursPerPiece)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{formatHoursNumber(item.totalHours)}</td>
                      {canEdit && (
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button type="button" onClick={() => { setEditingId(item.id); setEditDraft({ name: item.name, quantity: String(item.quantity), hours: String(item.estimatedHoursPerPiece) }) }} style={quietButton}>Edit</button>
                          <button type="button" onClick={() => void remove(item.id)} style={quietButton}>Remove</button>
                          <button type="button" onClick={() => void move(index, -1)} disabled={index === 0 || busy} style={quietButton}>Up</button>
                          <button type="button" onClick={() => void move(index, 1)} disabled={index === items.length - 1 || busy} style={quietButton}>Down</button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...td, fontWeight: 700 }}>Total</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{formatQuantity(pieceCount)} pieces</td>
                <td />
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{formatHoursNumber(hours)} total hrs</td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {items.length > 0 && isPhone && (
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>
          {formatQuantity(pieceCount)} pieces · {formatHoursNumber(hours)} total hrs
        </div>
      )}
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "#b42318" }}>{error}</div>}
    </section>
  )
}

const fieldStyle: CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #d0d5dd",
  borderRadius: 6,
  fontSize: 13,
  minWidth: 140,
}
const th: CSSProperties = { padding: "8px 8px 8px 0", fontWeight: 600, fontSize: 11, letterSpacing: 0.3 }
const td: CSSProperties = { padding: "8px 8px 8px 0", color: "#111" }
const addButton: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #1a1a2e",
  background: "#1a1a2e",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
}
const quietButton: CSSProperties = {
  padding: "6px 8px",
  border: "none",
  background: "none",
  color: "#4b5563",
  fontSize: 12,
  cursor: "pointer",
}
