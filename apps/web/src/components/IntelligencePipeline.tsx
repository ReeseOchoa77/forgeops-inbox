import type { CSSProperties } from 'react'

export type PipelineNodeDto = {
  id: string
  kind: string
  label: string
  description?: string
}

export type PipelineEdgeDto = {
  from: string
  to: string
  label?: string
}

/** Generic renderer — consumes registry pipeline metadata only. */
export function IntelligencePipelineView({
  nodes,
  edges,
}: {
  nodes: PipelineNodeDto[]
  edges: PipelineEdgeDto[]
}) {
  if (!nodes.length) {
    return <div style={{ color: '#9ca3af', fontSize: 13 }}>No pipeline metadata.</div>
  }

  const children = new Map<string, PipelineEdgeDto[]>()
  for (const e of edges) {
    const list = children.get(e.from) ?? []
    list.push(e)
    children.set(e.from, list)
  }
  const targets = new Set(edges.map((e) => e.to))
  const roots = nodes.filter((n) => !targets.has(n.id))
  const start = roots[0] ?? nodes[0]!

  const ordered: Array<{ node: PipelineNodeDto; edgeLabel?: string }> = []
  const visited = new Set<string>()
  const walk = (id: string, edgeLabel?: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const node = nodes.find((n) => n.id === id)
    if (!node) return
    ordered.push({ node, edgeLabel })
    const outs = children.get(id) ?? []
    for (const edge of outs) walk(edge.to, edge.label)
  }
  walk(start.id)
  for (const n of nodes) {
    if (!visited.has(n.id)) ordered.push({ node: n })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxWidth: 520 }}>
      {ordered.map((row, i) => (
        <div key={row.node.id}>
          {i > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2px 0' }}>
              <div style={{ width: 2, height: 14, background: '#d1d5db' }} />
              {row.edgeLabel ? (
                <span style={{ fontSize: 11, color: '#6b7280', margin: '2px 0' }}>{row.edgeLabel}</span>
              ) : null}
              <div style={{ width: 2, height: 14, background: '#d1d5db' }} />
            </div>
          )}
          <div style={nodeCard(row.node.kind)}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase' }}>
              {row.node.kind}
            </div>
            <div style={{ fontSize: 14, fontWeight: 650, color: '#111827', marginTop: 2 }}>{row.node.label}</div>
            {row.node.description ? (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{row.node.description}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function nodeCard(kind: string): CSSProperties {
  const accent =
    kind === 'MODEL'
      ? '#dbeafe'
      : kind === 'MARKER' || kind === 'RULE'
        ? '#ecfdf5'
        : kind === 'DECISION'
          ? '#fef3c7'
          : kind === 'PERSISTENCE'
            ? '#f3e8ff'
            : '#f9fafb'
  return {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '10px 12px',
    background: accent,
  }
}
