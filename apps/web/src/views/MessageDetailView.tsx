import { useEffect, useState } from 'react'
import { api, type MessageDetail } from '../api'
import { ConfidenceBadge, PriorityBadge, TypeBadge, ReviewStatusBadge } from '../components/Badges'

interface Props {
  workspaceId: string
  connectionId: string
  messageId: string
  onBack: () => void
}

function MetaField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div style={{ fontSize: 12, color: '#999', marginBottom: 2 }}>
      <span style={{ color: '#aaa' }}>{label}:</span> <span style={{ color: '#777', fontFamily: 'monospace', fontSize: 11 }}>{value}</span>
    </div>
  )
}

export function MessageDetailView({ workspaceId, connectionId, messageId, onBack }: Props) {
  const [data, setData] = useState<MessageDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRawBody, setShowRawBody] = useState(false)

  useEffect(() => {
    setLoading(true)
    setShowRawBody(false)
    api.getMessageDetail(workspaceId, connectionId, messageId)
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [workspaceId, connectionId, messageId])

  if (loading) return <p style={{ color: '#888', padding: 8 }}>Loading message...</p>
  if (!data) return <p>Message not found.</p>

  const { message, normalizedEmail, classification, taskCandidate, thread } = data

  return (
    <div>
      <button onClick={onBack} className="btn btn-sm btn-outline" style={{ marginBottom: 16 }}>
        &larr; Back to Inbox
      </button>

      {/* Message header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 8px', lineHeight: 1.3 }}>{message.subject ?? '(no subject)'}</h2>
        <div style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
          <strong>From:</strong> {message.senderName ?? message.senderEmail}
          {message.senderName && <span style={{ color: '#999' }}> &lt;{message.senderEmail}&gt;</span>}
        </div>
        {message.toAddresses.length > 0 && (
          <div style={{ fontSize: 13, color: '#888' }}>
            <strong>To:</strong> {message.toAddresses.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ')}
          </div>
        )}
        {message.ccAddresses.length > 0 && (
          <div style={{ fontSize: 13, color: '#888' }}>
            <strong>CC:</strong> {message.ccAddresses.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ')}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>
          {new Date(message.receivedAt ?? message.sentAt).toLocaleString()}
          {thread.messageCount > 1 && <span> &middot; {thread.messageCount} messages in thread</span>}
          {message.hasAttachments && <span> &middot; Has attachments</span>}
          <span> &middot; {message.itemStatus.replace(/_/g, ' ')}</span>
        </div>
      </div>

      {/* Classification */}
      {classification ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px', fontWeight: 600 }}>Classification</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px 20px', fontSize: 13 }}>
            <div>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>Category</div>
              <TypeBadge type={classification.emailType} />
            </div>
            <div>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>Priority</div>
              <PriorityBadge priority={classification.priority} />
            </div>
            <div>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>Confidence</div>
              <ConfidenceBadge confidence={classification.confidence} />
            </div>
            <div>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>Action requested?</div>
              <span style={{ fontWeight: 500 }}>{classification.containsActionRequest ? 'Yes' : 'No'}</span>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>Review status</div>
              <ReviewStatusBadge status={classification.reviewStatus} />
            </div>
          </div>
          {classification.summary && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#f8f9fa', borderRadius: 4, fontSize: 13, lineHeight: 1.5 }}>
              <strong>Summary:</strong> {classification.summary}
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16, opacity: 0.6 }}>
          <h3 style={{ fontSize: 14, margin: 0, color: '#888' }}>Classification: not yet analyzed</h3>
        </div>
      )}

      {/* Extracted task */}
      {taskCandidate ? (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #1565c0' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px', fontWeight: 600 }}>Extracted Task</h3>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{taskCandidate.title}</div>
          {taskCandidate.summary && <div style={{ fontSize: 13, color: '#666', marginBottom: 8, lineHeight: 1.5 }}>{taskCandidate.summary}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px 20px', fontSize: 13 }}>
            {taskCandidate.assigneeGuess && (
              <div>
                <div style={{ color: '#888', fontSize: 11 }}>Suggested assignee</div>
                <div style={{ fontWeight: 500 }}>{taskCandidate.assigneeGuess}</div>
              </div>
            )}
            {taskCandidate.dueAt && (
              <div>
                <div style={{ color: '#888', fontSize: 11 }}>Due date</div>
                <div style={{ fontWeight: 500 }}>{new Date(taskCandidate.dueAt).toLocaleDateString()}</div>
              </div>
            )}
            <div>
              <div style={{ color: '#888', fontSize: 11 }}>Priority</div>
              <PriorityBadge priority={taskCandidate.priority} />
            </div>
            <div>
              <div style={{ color: '#888', fontSize: 11 }}>Confidence</div>
              <ConfidenceBadge confidence={taskCandidate.confidence} />
            </div>
            <div>
              <div style={{ color: '#888', fontSize: 11 }}>Review</div>
              <ReviewStatusBadge status={taskCandidate.reviewStatus} />
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16, opacity: 0.6 }}>
          <h3 style={{ fontSize: 14, margin: 0, color: '#888' }}>Task: none extracted from this message</h3>
        </div>
      )}

      {/* Linked entities (future enrichment) */}
      <div className="card" style={{ marginBottom: 16, opacity: 0.5, borderStyle: 'dashed' }}>
        <h3 style={{ fontSize: 14, margin: '0 0 6px', fontWeight: 600, color: '#888' }}>Linked Entities</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 13 }}>
          <div>
            <div style={{ color: '#aaa', fontSize: 11 }}>Customer</div>
            <div style={{ color: '#bbb' }}>Not linked yet</div>
          </div>
          <div>
            <div style={{ color: '#aaa', fontSize: 11 }}>Vendor</div>
            <div style={{ color: '#bbb' }}>Not linked yet</div>
          </div>
          <div>
            <div style={{ color: '#aaa', fontSize: 11 }}>Job</div>
            <div style={{ color: '#bbb' }}>Not linked yet</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#ccc', marginTop: 8 }}>
          These fields will be populated once customer/vendor/job matching is enabled.
        </div>
      </div>

      {/* Email body */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>
            {showRawBody ? 'Raw Email Body' : normalizedEmail ? 'Email Body (cleaned)' : 'Email Body'}
          </h3>
          {normalizedEmail && message.bodyText && (
            <button className="btn btn-sm btn-outline" onClick={() => setShowRawBody(v => !v)}>
              {showRawBody ? 'Show cleaned' : 'Show raw'}
            </button>
          )}
        </div>
        {!showRawBody && normalizedEmail && normalizedEmail.categoryHints.length > 0 && (
          <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>
            Detected signals: {normalizedEmail.categoryHints.join(', ')}
          </div>
        )}
        {!showRawBody && normalizedEmail && normalizedEmail.labelHints.length > 0 && (
          <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>
            Labels: {normalizedEmail.labelHints.join(', ')}
          </div>
        )}
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          background: '#fafafa', padding: 16, borderRadius: 6,
          fontSize: 13, lineHeight: 1.6, border: '1px solid #eee',
          maxHeight: 500, overflow: 'auto', margin: 0
        }}>
          {showRawBody
            ? (message.bodyText ?? '(empty body)')
            : (normalizedEmail?.cleanTextBody ?? message.bodyText ?? '(empty body)')
          }
        </pre>
      </div>

      {/* Debug metadata */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: '#999', padding: '8px 0' }}>
          Debug metadata
        </summary>
        <div className="card" style={{ marginTop: 8, background: '#fafafa' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
            <MetaField label="Message ID" value={message.id} />
            <MetaField label="Provider message ID" value={(message as Record<string, unknown>).providerMessageId as string} />
            <MetaField label="Provider thread ID" value={(message as Record<string, unknown>).providerThreadId as string} />
            <MetaField label="Thread ID" value={thread.id} />
            <MetaField label="Sent at" value={message.sentAt} />
            <MetaField label="Received at" value={message.receivedAt} />
            <MetaField label="Item status" value={message.itemStatus} />
            <MetaField label="Priority" value={message.priority} />
            {normalizedEmail && (
              <>
                <MetaField label="Sender domain" value={normalizedEmail.senderDomain} />
                <MetaField label="Normalized subject" value={thread.subject !== (thread as Record<string, unknown>).normalizedSubject ? (thread as Record<string, unknown>).normalizedSubject as string : null} />
              </>
            )}
            {message.labelIds.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <MetaField label="Label IDs" value={message.labelIds.join(', ')} />
              </div>
            )}
            {classification && (
              <MetaField label="Classification ID" value={classification.id} />
            )}
            {taskCandidate && (
              <MetaField label="Task ID" value={taskCandidate.id} />
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
