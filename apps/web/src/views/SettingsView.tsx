interface Props {
  workspaceName: string
}

export function SettingsView({ workspaceName: _workspaceName }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>&#9881;</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#1a1a2e' }}>
          Settings &mdash; Coming Soon
        </h2>
        <p style={{ fontSize: 14, color: '#888', lineHeight: 1.6, margin: 0 }}>
          Workspace settings will be available in a future update.
        </p>
      </div>
    </div>
  )
}
