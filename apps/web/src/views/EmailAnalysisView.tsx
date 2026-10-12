import { useEffect, useState } from 'react'
import { FoldersView } from './FoldersView'
import { BiddingFolderAnalysisView } from './BiddingFolderAnalysisView'

export type EmailAnalysisMode = 'project' | 'bidding'

interface Props {
  workspaceId: string
  connectionId: string
  userRole?: string
  initialMode?: EmailAnalysisMode
  onOpenMessage?: (messageId: string, inboxConnectionId: string) => void
}

/**
 * Systems → Email Analysis
 * Two isolated modes: Project Folder Analysis | Bidding Folder Analysis
 */
export function EmailAnalysisView({
  workspaceId,
  connectionId,
  userRole = 'MEMBER',
  initialMode = 'project',
  onOpenMessage,
}: Props) {
  const [mode, setMode] = useState<EmailAnalysisMode>(initialMode)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode, workspaceId])

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Email Analysis</h2>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
        Workspace-scoped discovery and analysis. Project folders and bidding folders are separate
        operations.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 14,
          borderBottom: '2px solid #e5e5e5',
          flexWrap: 'wrap',
        }}
      >
        {(
          [
            { id: 'project' as const, label: 'Project Folder Analysis' },
            { id: 'bidding' as const, label: 'Bidding Folder Analysis' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMode(t.id)}
            style={{
              padding: '7px 18px',
              fontSize: 13,
              fontWeight: mode === t.id ? 600 : 400,
              color: mode === t.id ? '#1a1a2e' : '#888',
              background: 'none',
              border: 'none',
              borderBottom: mode === t.id ? '2px solid #1a1a2e' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'project' ? (
        <FoldersView
          workspaceId={workspaceId}
          connectionId={connectionId}
          userRole={userRole}
          embedded
        />
      ) : (
        <BiddingFolderAnalysisView
          workspaceId={workspaceId}
          connectionId={connectionId}
          userRole={userRole}
          onOpenMessage={onOpenMessage}
        />
      )}
    </div>
  )
}
