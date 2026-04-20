interface Props {
  workspaceName: string
}

export function SettingsView({ workspaceName }: Props) {
  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Settings</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px' }}>
        Workspace settings for <strong>{workspaceName || 'your workspace'}</strong>. These features are being built.
      </p>

      <div className="card">
        <h3 style={{ fontSize: 15, margin: '0 0 6px', fontWeight: 600 }}>Review Thresholds</h3>
        <p style={{ fontSize: 13, color: '#888', margin: 0, lineHeight: 1.5 }}>
          Control how confident the system needs to be before it auto-approves a classification or task.
          Items below the threshold are sent to the Review Queue for human confirmation.
        </p>
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#f8f9fa', borderRadius: 4, fontSize: 13, color: '#aaa' }}>
          Coming soon. Currently using default threshold of 75%.
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, margin: '0 0 6px', fontWeight: 600 }}>Routing Rules</h3>
        <p style={{ fontSize: 13, color: '#888', margin: 0, lineHeight: 1.5 }}>
          Automatically assign, prioritize, or route emails based on their classification.
          For example: "If category is Support Issue, set priority to High and assign to the support team."
        </p>
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#f8f9fa', borderRadius: 4, fontSize: 13, color: '#aaa' }}>
          Coming soon.
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, margin: '0 0 6px', fontWeight: 600 }}>Workspace</h3>
        <p style={{ fontSize: 13, color: '#888', margin: 0, lineHeight: 1.5 }}>
          Rename your workspace, set the default timezone, or adjust workspace-level defaults.
        </p>
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#f8f9fa', borderRadius: 4, fontSize: 13, color: '#aaa' }}>
          Coming soon.
        </div>
      </div>
    </div>
  )
}
