import { useEffect, useState } from 'react'
import { api, type ApprovedAccessEntry } from '../api'

interface Props {
  workspaceId: string
}

export function TeamAccessView({ workspaceId }: Props) {
  const [entries, setEntries] = useState<ApprovedAccessEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState('MEMBER')
  const [adding, setAdding] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError('')
    api.getApprovedAccess(workspaceId)
      .then(r => setEntries(r.entries))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [workspaceId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmail.trim()) return
    setAdding(true)
    try {
      await api.addApprovedAccess(workspaceId, newEmail.trim(), newRole)
      setNewEmail('')
      setNewRole('MEMBER')
      load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add')
    } finally {
      setAdding(false)
    }
  }

  const handleRevoke = async (accessId: string) => {
    if (!confirm('Revoke this user\'s access? They will not be able to sign in until re-approved.')) return
    setRevoking(accessId)
    try {
      await api.revokeApprovedAccess(workspaceId, accessId)
      load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke')
    } finally {
      setRevoking(null)
    }
  }

  if (loading) return <p>Loading team access...</p>

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-icon">&#128274;</div>
        <h3>Cannot Load Team Access</h3>
        <p>{error}</p>
        <p style={{ fontSize: 13, color: '#aaa' }}>Admin or Owner role is required to manage team access.</p>
      </div>
    )
  }

  const activeEntries = entries.filter(e => e.status === 'ACTIVE')
  const revokedEntries = entries.filter(e => e.status === 'REVOKED')

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Team Access</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px' }}>
        Only people with approved email addresses can sign into this workspace. Add team members here before they try to log in.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 12px' }}>Add a Team Member</h3>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="email"
            placeholder="colleague@company.com"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            required
            style={{ flex: '1 1 240px', padding: '7px 10px', border: '1px solid #d0d0d0', borderRadius: 4, fontSize: 14 }}
          />
          <select value={newRole} onChange={e => setNewRole(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #d0d0d0', borderRadius: 4, fontSize: 14 }}>
            <option value="OWNER">Owner</option>
            <option value="ADMIN">Admin</option>
            <option value="MANAGER">Manager</option>
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={adding}>
            {adding ? 'Adding...' : 'Add'}
          </button>
        </form>
      </div>

      {activeEntries.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">&#128101;</div>
          <h3>No team members yet</h3>
          <p>Add email addresses above to approve people for this workspace.</p>
        </div>
      )}

      {activeEntries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e5e5', textAlign: 'left' }}>
              <th style={{ padding: '8px 10px' }}>Email</th>
              <th style={{ padding: '8px 10px' }}>Role</th>
              <th style={{ padding: '8px 10px' }}>Added by</th>
              <th style={{ padding: '8px 10px' }}>Added</th>
              <th style={{ padding: '8px 10px' }}></th>
            </tr>
          </thead>
          <tbody>
            {activeEntries.map(entry => (
              <tr key={entry.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px 10px', fontWeight: 500 }}>{entry.email}</td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ background: '#f0f0f0', padding: '2px 8px', borderRadius: 3, fontSize: 12 }}>{entry.role}</span>
                </td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: '#888' }}>{entry.invitedBy?.email ?? '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13, color: '#888' }}>
                  {new Date(entry.createdAt).toLocaleDateString()}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <button className="btn btn-sm btn-danger"
                    disabled={revoking === entry.id}
                    onClick={() => handleRevoke(entry.id)}>
                    {revoking === entry.id ? '...' : 'Revoke'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revokedEntries.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#888' }}>
            {revokedEntries.length} revoked
          </summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8, opacity: 0.6 }}>
            <tbody>
              {revokedEntries.map(entry => (
                <tr key={entry.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 10px' }}>{entry.email}</td>
                  <td style={{ padding: '6px 10px' }}>{entry.role}</td>
                  <td style={{ padding: '6px 10px', color: '#c62828' }}>Revoked</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
