import { useEffect, useState } from 'react'
import { api, type TaskListItem } from '../api'
import { ConfidenceBadge, PriorityBadge, TypeBadge, ReviewStatusBadge, StatusBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

export function TasksView({ workspaceId, connectionId }: Props) {
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setPage(1) }, [connectionId])

  useEffect(() => {
    setLoading(true)
    api.getTasks(workspaceId, connectionId, page)
      .then(r => {
        setTasks(r.tasks)
        setTotalPages(r.pagination.totalPages)
        setTotalCount(r.pagination.totalCount)
      })
      .finally(() => setLoading(false))
  }, [workspaceId, connectionId, page])

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading tasks...</p>

  if (tasks.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">&#9745;</div>
        <h3>No tasks found</h3>
        <p>Tasks are automatically extracted from actionable emails. They'll appear here after you sync and analyze an inbox.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Tasks</h2>
        <p style={{ fontSize: 13, color: '#888', margin: 0 }}>{totalCount} tasks extracted from your inbox messages.</p>
      </div>

      {tasks.map(({ task, sourceMessage, classification }) => (
        <div key={task.id} className="card" style={{ borderLeft: '3px solid #1565c0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{task.title}</div>
              {task.summary && <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 8 }}>{task.summary}</div>}
            </div>
            <div style={{ flexShrink: 0, display: 'flex', gap: 6 }}>
              <PriorityBadge priority={task.priority} />
              <StatusBadge status={task.status} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px 16px', fontSize: 13, marginTop: 4 }}>
            {task.assigneeGuess && (
              <div>
                <div style={{ color: '#aaa', fontSize: 11 }}>Assignee guess</div>
                <div style={{ color: '#555', fontWeight: 500 }}>{task.assigneeGuess}</div>
              </div>
            )}
            <div>
              <div style={{ color: '#aaa', fontSize: 11 }}>Due date</div>
              <div style={{ color: task.dueAt ? '#555' : '#ccc', fontWeight: task.dueAt ? 500 : 400 }}>
                {task.dueAt ? formatDate(task.dueAt) : 'Not detected'}
              </div>
            </div>
            <div>
              <div style={{ color: '#aaa', fontSize: 11 }}>Confidence</div>
              <ConfidenceBadge confidence={task.confidence} />
            </div>
            <div>
              <div style={{ color: '#aaa', fontSize: 11 }}>Review</div>
              <ReviewStatusBadge status={task.reviewStatus} />
            </div>
            <div>
              <div style={{ color: '#aaa', fontSize: 11 }}>Created</div>
              <div style={{ color: '#888', fontSize: 12 }}>{formatDate(task.createdAt)}</div>
            </div>
          </div>

          {/* Source email */}
          {sourceMessage && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#999' }}>
              <span style={{ color: '#aaa' }}>Source:</span> {sourceMessage.senderEmail}
              <span style={{ color: '#ddd' }}> &middot; </span>
              {sourceMessage.subject?.slice(0, 60) ?? '(no subject)'}
              {sourceMessage.receivedAt && (
                <span><span style={{ color: '#ddd' }}> &middot; </span>{formatDate(sourceMessage.receivedAt)}</span>
              )}
            </div>
          )}

          {/* Classification context */}
          {classification && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
              <span style={{ color: '#aaa' }}>Classification:</span> <TypeBadge type={classification.emailType} />
              {classification.summary && <span style={{ marginLeft: 8 }}>{classification.summary.slice(0, 80)}</span>}
            </div>
          )}

          {/* Future enrichment placeholders */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f5f5f5', display: 'flex', gap: 16, fontSize: 11, color: '#ccc' }}>
            <span>Customer: —</span>
            <span>Vendor: —</span>
            <span>Job: —</span>
          </div>
        </div>
      ))}

      {totalPages > 1 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span style={{ fontSize: 13, color: '#888' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-sm btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
