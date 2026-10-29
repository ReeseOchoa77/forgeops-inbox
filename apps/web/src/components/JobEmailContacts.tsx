import type { JobEmailContact } from '../api'

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1.4fr auto',
  gap: 8,
  padding: '8px 0',
  borderBottom: '1px solid #f0f0f0',
  fontSize: 12,
  alignItems: 'center',
}

type Props = {
  contacts: JobEmailContact[]
  isPhone: boolean
}

export function JobEmailContacts({ contacts, isPhone }: Props) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        Email Contacts
      </div>
      {contacts.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6b7280' }}>No email contacts saved yet.</div>
      ) : (
        <div>
          {!isPhone && (
            <div style={{ ...rowStyle, color: '#9ca3af', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>
              <div>Name</div>
              <div>Email</div>
              <div />
            </div>
          )}
          {contacts.map((c) => (
            <div key={c.id} style={isPhone ? { ...rowStyle, gridTemplateColumns: '1fr' } : rowStyle}>
              <div style={{ fontWeight: 600, color: '#111827' }}>{c.name?.trim() || '—'}</div>
              <div style={{ color: '#374151' }}>{c.email || '—'}</div>
              {c.source === 'LEARNED_FROM_EMAIL' && (
                <div style={{ fontSize: 11, color: '#9ca3af' }}>Saved from email</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
