import { useEffect, useState, useCallback } from 'react'
import { api, type JobDetail, type JobEmail, type JobTask, type JobDocument, type JobActivity, type JobSummary } from '../api'

interface Props {
  workspaceId: string
  jobId: string
  userRole: string
  onBack: () => void
}

type Tab = 'overview' | 'emails' | 'tasks' | 'documents' | 'activity' | 'settings'

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  LEAD: { bg: '#e9ecef', color: '#495057' },
  BIDDING: { bg: '#dbeafe', color: '#1d4ed8' },
  AWARDED: { bg: '#ede9fe', color: '#7c3aed' },
  ACTIVE: { bg: '#dcfce7', color: '#16a34a' },
  ON_HOLD: { bg: '#fef9c3', color: '#a16207' },
  COMPLETE: { bg: '#ccfbf1', color: '#0d9488' },
  ARCHIVED: { bg: '#e9ecef', color: '#6b7280' },
}

const STATUSES = ['LEAD', 'BIDDING', 'AWARDED', 'ACTIVE', 'ON_HOLD', 'COMPLETE']

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_COLORS[status] ?? { bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, background: style.bg, color: style.color,
      textTransform: 'uppercase', letterSpacing: 0.3
    }}>
      {status.replace('_', ' ')}
    </span>
  )
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function Card({ title, children, style: s }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, ...s }}>
      {title && <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>}
      {children}
    </div>
  )
}

function MetricCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? '#111' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{label}</div>
    </div>
  )
}

export function JobDetailView({ workspaceId, jobId, userRole, onBack }: Props) {
  const [job, setJob] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [emails, setEmails] = useState<JobEmail[]>([])
  const [emailPage, setEmailPage] = useState(1)
  const [emailTotalPages, setEmailTotalPages] = useState(1)
  const [emailSearch, setEmailSearch] = useState('')
  const [tasks, setTasks] = useState<JobTask[]>([])
  const [documents, setDocuments] = useState<JobDocument[]>([])
  const [activity, setActivity] = useState<JobActivity[]>([])
  const [activityPage, setActivityPage] = useState(1)
  const [activityTotalPages, setActivityTotalPages] = useState(1)

  const [editName, setEditName] = useState('')
  const [editJobNumber, setEditJobNumber] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editStartDate, setEditStartDate] = useState('')
  const [editTargetDate, setEditTargetDate] = useState('')
  const [newAlias, setNewAlias] = useState('')
  const [saving, setSaving] = useState(false)

  const [moveJobId, setMoveJobId] = useState('')
  const [allJobs, setAllJobs] = useState<JobSummary[]>([])
  const [showMoveModal, setShowMoveModal] = useState<string | null>(null)

  const canEdit = userRole === 'OWNER' || userRole === 'ADMIN' || userRole === 'MEMBER'

  const loadJob = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getJob(workspaceId, jobId)
      setJob(res.job)
      setEditName(res.job.name)
      setEditJobNumber(res.job.jobNumber ?? '')
      setEditStatus(res.job.status)
      setEditDescription(res.job.description ?? '')
      setEditNotes(res.job.notes ?? '')
      setEditStartDate(res.job.startDate?.split('T')[0] ?? '')
      setEditTargetDate(res.job.targetCompletionDate?.split('T')[0] ?? '')
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId])

  useEffect(() => { loadJob() }, [loadJob])

  useEffect(() => {
    api.getJobs(workspaceId, { pageSize: 100, showArchived: false })
      .then(r => setAllJobs(r.jobs))
      .catch(() => {})
  }, [workspaceId])

  useEffect(() => {
    if (tab === 'emails') {
      api.getJobEmails(workspaceId, jobId, emailPage).then(r => {
        setEmails(r.emails)
        setEmailTotalPages(r.pagination.totalPages)
      }).catch(() => {})
    }
  }, [tab, workspaceId, jobId, emailPage])

  useEffect(() => {
    if (tab === 'tasks') {
      api.getJobTasks(workspaceId, jobId).then(r => setTasks(r.tasks)).catch(() => {})
    }
  }, [tab, workspaceId, jobId])

  useEffect(() => {
    if (tab === 'documents') {
      api.getJobDocuments(workspaceId, jobId).then(r => setDocuments(r.documents)).catch(() => {})
    }
  }, [tab, workspaceId, jobId])

  useEffect(() => {
    if (tab === 'activity') {
      api.getJobActivity(workspaceId, jobId, activityPage).then(r => {
        setActivity(r.activity)
        setActivityTotalPages(r.pagination.totalPages)
      }).catch(() => {})
    }
  }, [tab, workspaceId, jobId, activityPage])

  const handleSave = async () => {
    if (!canEdit) return
    setSaving(true)
    try {
      const res = await api.updateJob(workspaceId, jobId, {
        name: editName,
        jobNumber: editJobNumber,
        status: editStatus,
        description: editDescription || undefined,
        notes: editNotes || undefined,
        startDate: editStartDate || null,
        targetCompletionDate: editTargetDate || null,
      })
      setJob(res.job)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!job) return
    if (job.archivedAt) {
      await api.restoreJob(workspaceId, jobId)
    } else {
      await api.archiveJob(workspaceId, jobId)
    }
    loadJob()
  }

  const handleAddAlias = async () => {
    if (!newAlias.trim()) return
    await api.addJobAlias(workspaceId, jobId, newAlias.trim())
    setNewAlias('')
    loadJob()
  }

  const handleRemoveAlias = async (aliasId: string) => {
    await api.removeJobAlias(workspaceId, jobId, aliasId)
    loadJob()
  }

  const handleRemoveMember = async (userId: string) => {
    await api.removeJobMember(workspaceId, jobId, userId)
    loadJob()
  }

  const handleRemoveEmail = async (messageId: string) => {
    await api.removeEmailFromJob(workspaceId, jobId, messageId)
    setEmails(prev => prev.filter(e => e.id !== messageId))
  }

  const handleMoveEmail = async (messageId: string) => {
    if (!moveJobId) return
    try {
      await api.moveEmailToJob(workspaceId, jobId, { messageId, targetJobId: moveJobId })
      setEmails(prev => prev.filter(e => e.id !== messageId))
      setShowMoveModal(null)
      setMoveJobId('')
    } catch { /* ignore */ }
  }

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#888' }}>Loading job...</div>
  }

  if (!job) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#888' }}>Job not found.</div>
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'emails', label: 'Emails' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
    { key: 'settings', label: 'Settings' },
  ]

  const filteredEmails = emailSearch
    ? emails.filter(e =>
        (e.subject ?? '').toLowerCase().includes(emailSearch.toLowerCase()) ||
        (e.senderName ?? '').toLowerCase().includes(emailSearch.toLowerCase()) ||
        e.senderEmail.toLowerCase().includes(emailSearch.toLowerCase())
      )
    : emails

  const openTasks = tasks.filter(t => t.status === 'OPEN' || t.status === 'IN_PROGRESS' || t.status === 'BLOCKED')
  const completedTasks = tasks.filter(t => t.status === 'DONE')
  const cancelledTasks = tasks.filter(t => t.status === 'CANCELLED')

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', marginBottom: 8, padding: 0 }}
        >
          &larr; Back to Jobs
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{job.name}</h2>
          {job.jobNumber && <span style={{ fontSize: 13, color: '#6b7280', fontFamily: 'monospace' }}>#{job.jobNumber}</span>}
          <StatusBadge status={job.status} />
          {job.archivedAt && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 500 }}>ARCHIVED</span>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? '#1a1a2e' : '#6b7280',
              borderBottom: tab === t.key ? '2px solid #1a1a2e' : '2px solid transparent',
              marginBottom: -1
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            <MetricCard label="Total Emails" value={job.emailCount} />
            <MetricCard label="Emails (7d)" value={job.recentEmails7d} />
            <MetricCard label="Emails (30d)" value={job.recentEmails30d} />
            <MetricCard label="Open Tasks" value={job.openTaskCount} accent={job.openTaskCount > 0 ? '#2563eb' : undefined} />
            <MetricCard label="Overdue Tasks" value={job.overdueTaskCount} accent={job.overdueTaskCount > 0 ? '#dc2626' : undefined} />
            <MetricCard label="Completed Tasks" value={job.completedTaskCount} accent="#16a34a" />
            <MetricCard label="Attachments" value={job.attachmentCount} />
            <MetricCard label="Next Due" value={job.nextDueDate ? formatDate(job.nextDueDate) : '—'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card title="Details">
              <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <div><span style={{ color: '#6b7280' }}>Customer:</span> <strong>{job.customerName ?? '—'}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Start Date:</span> {formatDate(job.startDate)}</div>
                <div><span style={{ color: '#6b7280' }}>Target Completion:</span> {formatDate(job.targetCompletionDate)}</div>
                <div><span style={{ color: '#6b7280' }}>Last Activity:</span> {formatDateTime(job.lastActivityAt)}</div>
                <div><span style={{ color: '#6b7280' }}>Created:</span> {formatDate(job.createdAt)}</div>
                {job.description && <div style={{ marginTop: 8, color: '#374151', lineHeight: 1.5 }}>{job.description}</div>}
              </div>
            </Card>

            <Card title="Team">
              {job.members.length === 0 ? (
                <div style={{ color: '#888', fontSize: 13 }}>No members assigned</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {job.members.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', background: '#e0e7ff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600, color: '#4338ca'
                      }}>
                        {(m.name ?? m.email)[0].toUpperCase()}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name ?? m.email}</div>
                        {m.role && <div style={{ fontSize: 11, color: '#6b7280' }}>{m.role}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {job.aliases.length > 0 && (
            <Card title="Email Aliases" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {job.aliases.map(a => (
                  <span key={a.id} style={{ padding: '4px 10px', background: '#f3f4f6', borderRadius: 12, fontSize: 12 }}>
                    {a.alias}
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Emails Tab */}
      {tab === 'emails' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search emails..."
              value={emailSearch}
              onChange={e => setEmailSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
            />
          </div>
          {filteredEmails.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 14 }}>No emails assigned to this job.</div>
          ) : (
            <>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                {filteredEmails.map((email, i) => (
                  <div
                    key={email.id}
                    style={{
                      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                      borderBottom: i < filteredEmails.length - 1 ? '1px solid #f0f0f0' : undefined
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {email.subject ?? '(no subject)'}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {email.senderName ?? email.senderEmail} &middot; {formatDateTime(email.sentAt)}
                      </div>
                    </div>
                    {email.jobAssignmentSource && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: email.jobAssignmentIsManual ? '#dbeafe' : '#f3f4f6',
                        color: email.jobAssignmentIsManual ? '#1d4ed8' : '#6b7280'
                      }}>
                        {email.jobAssignmentSource}
                      </span>
                    )}
                    {canEdit && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => { setShowMoveModal(email.id); setMoveJobId('') }}
                          style={{ background: 'none', border: '1px solid #d0d5dd', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#555', padding: '3px 8px' }}
                          title="Move to another job"
                        >
                          Move
                        </button>
                        <button
                          onClick={() => handleRemoveEmail(email.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#999', padding: '4px 8px' }}
                          title="Remove from job"
                        >
                          &times;
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {emailTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button disabled={emailPage <= 1} onClick={() => setEmailPage(p => p - 1)} style={{ padding: '4px 10px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: emailPage > 1 ? 'pointer' : 'not-allowed', opacity: emailPage <= 1 ? 0.5 : 1 }}>Prev</button>
                  <span style={{ fontSize: 12, alignSelf: 'center', color: '#6b7280' }}>Page {emailPage} of {emailTotalPages}</span>
                  <button disabled={emailPage >= emailTotalPages} onClick={() => setEmailPage(p => p + 1)} style={{ padding: '4px 10px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: emailPage < emailTotalPages ? 'pointer' : 'not-allowed', opacity: emailPage >= emailTotalPages ? 0.5 : 1 }}>Next</button>
                </div>
              )}
            </>
          )}

          {/* Move email modal */}
          {showMoveModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 400, background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
                <h4 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600 }}>Move Email to Another Job</h4>
                <select
                  value={moveJobId}
                  onChange={e => setMoveJobId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, marginBottom: 14 }}
                >
                  <option value="">Select target job...</option>
                  {allJobs.filter(j => j.id !== jobId).map(j => (
                    <option key={j.id} value={j.id}>
                      {j.jobNumber ? `${j.jobNumber} — ${j.name}` : j.name}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setShowMoveModal(null)} style={{ padding: '6px 14px', border: '1px solid #d0d5dd', borderRadius: 5, background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={() => handleMoveEmail(showMoveModal)} disabled={!moveJobId} style={{ padding: '6px 14px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: moveJobId ? 1 : 0.5 }}>Move</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tasks Tab */}
      {tab === 'tasks' && (
        <div>
          {tasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 14 }}>No tasks linked to this job.</div>
          ) : (
            <div>
              {openTasks.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Open ({openTasks.length})</div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Title</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Priority</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openTasks.map(task => (
                          <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 500 }}>{task.title}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                                background: task.status === 'IN_PROGRESS' ? '#dbeafe' : task.status === 'BLOCKED' ? '#fef9c3' : '#f3f4f6',
                                color: task.status === 'IN_PROGRESS' ? '#1d4ed8' : task.status === 'BLOCKED' ? '#a16207' : '#374151'
                              }}>
                                {task.status}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                fontSize: 11, fontWeight: 600,
                                color: task.priority === 'HIGH' || task.priority === 'URGENT' ? '#dc2626' : task.priority === 'MEDIUM' ? '#d97706' : '#6b7280'
                              }}>
                                {task.priority}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: task.dueAt && new Date(task.dueAt) < new Date() ? '#dc2626' : '#6b7280' }}>
                              {formatDate(task.dueAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {completedTasks.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>Completed ({completedTasks.length})</div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {completedTasks.map(task => (
                          <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 500, color: '#6b7280', textDecoration: 'line-through' }}>{task.title}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: '#dcfce7', color: '#16a34a' }}>DONE</span>
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: '#6b7280' }}>{formatDate(task.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {cancelledTasks.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>Cancelled ({cancelledTasks.length})</div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {cancelledTasks.map(task => (
                          <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 500, color: '#9ca3af', textDecoration: 'line-through' }}>{task.title}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: '#f3f4f6', color: '#6b7280' }}>CANCELLED</span>
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>{formatDate(task.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Documents Tab */}
      {tab === 'documents' && (
        <div>
          {documents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 14 }}>No documents attached to this job.</div>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              {documents.map((doc, i) => (
                <div
                  key={doc.id}
                  style={{
                    padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                    borderBottom: i < documents.length - 1 ? '1px solid #f0f0f0' : undefined
                  }}
                >
                  <span style={{ fontSize: 20 }}>📎</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.filename}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {doc.mimeType} &middot; {formatBytes(doc.sizeBytes)} &middot; from {doc.emailSenderEmail}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{formatDate(doc.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Activity Tab */}
      {tab === 'activity' && (
        <div>
          {activity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 14 }}>No activity recorded.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {activity.map((entry, i) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: '12px 0', borderBottom: i < activity.length - 1 ? '1px solid #f0f0f0' : undefined,
                      display: 'flex', gap: 12, alignItems: 'flex-start'
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', background: '#c7d2fe',
                      marginTop: 6, flexShrink: 0
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>{entry.actorName ?? entry.actorEmail ?? 'System'}</strong>{' '}
                        <span style={{ color: '#374151' }}>{entry.action}</span>
                        {entry.entityType && <span style={{ color: '#6b7280' }}> ({entry.entityType})</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{formatDateTime(entry.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
              {activityTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button disabled={activityPage <= 1} onClick={() => setActivityPage(p => p - 1)} style={{ padding: '4px 10px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: activityPage > 1 ? 'pointer' : 'not-allowed', opacity: activityPage <= 1 ? 0.5 : 1 }}>Prev</button>
                  <span style={{ fontSize: 12, alignSelf: 'center', color: '#6b7280' }}>Page {activityPage} of {activityTotalPages}</span>
                  <button disabled={activityPage >= activityTotalPages} onClick={() => setActivityPage(p => p + 1)} style={{ padding: '4px 10px', border: '1px solid #d0d5dd', borderRadius: 4, background: '#fff', cursor: activityPage < activityTotalPages ? 'pointer' : 'not-allowed', opacity: activityPage >= activityTotalPages ? 0.5 : 1 }}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && (
        <div style={{ maxWidth: 640 }}>
          <Card title="Job Details" style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} disabled={!canEdit}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Job Number</label>
                  <input value={editJobNumber} onChange={e => setEditJobNumber(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Status</label>
                  <select value={editStatus} onChange={e => setEditStatus(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Start Date</label>
                  <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Target Completion</label>
                  <input type="date" value={editTargetDate} onChange={e => setEditTargetDate(e.target.value)} disabled={!canEdit}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} disabled={!canEdit} rows={3}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} disabled={!canEdit} rows={3}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, resize: 'vertical' }} />
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleSave} disabled={saving}
                    style={{ padding: '8px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* Aliases */}
          <Card title="Email Aliases" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: job.aliases.length > 0 ? 12 : 0 }}>
              {job.aliases.map(a => (
                <span key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#f3f4f6', borderRadius: 12, fontSize: 12 }}>
                  {a.alias}
                  {canEdit && (
                    <button onClick={() => handleRemoveAlias(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999', padding: 0, marginLeft: 4 }}>&times;</button>
                  )}
                </span>
              ))}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={newAlias} onChange={e => setNewAlias(e.target.value)} placeholder="Add alias (e.g. job-123@company.com)"
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
                  onKeyDown={e => e.key === 'Enter' && handleAddAlias()} />
                <button onClick={handleAddAlias}
                  style={{ padding: '6px 14px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Add
                </button>
              </div>
            )}
          </Card>

          {/* Members */}
          <Card title="Members" style={{ marginBottom: 16 }}>
            {job.members.length === 0 ? (
              <div style={{ color: '#888', fontSize: 13 }}>No members assigned.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {job.members.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', background: '#e0e7ff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600, color: '#4338ca'
                      }}>
                        {(m.name ?? m.email)[0].toUpperCase()}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name ?? m.email}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{m.email}{m.role ? ` · ${m.role}` : ''}</div>
                      </div>
                    </div>
                    {canEdit && (
                      <button onClick={() => handleRemoveMember(m.userId)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999' }}>
                        &times;
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Archive/Restore */}
          {canEdit && (
            <Card title="Danger Zone">
              <button onClick={handleArchive}
                style={{
                  padding: '8px 16px', border: '1px solid #dc2626', borderRadius: 6,
                  background: job.archivedAt ? '#fff' : '#fef2f2', color: '#dc2626',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer'
                }}>
                {job.archivedAt ? 'Restore Job' : 'Archive Job'}
              </button>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
