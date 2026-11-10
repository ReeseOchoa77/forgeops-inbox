/**
 * Canonical safe email body renderer (DOMPurify).
 * Shared by Inbox MessageDetailView patterns and Intelligence evaluation inspector.
 */
import { useState, type CSSProperties } from 'react'
import DOMPurify from 'dompurify'

export function SafeEmailBody({
  bodyHtml,
  bodyText,
}: {
  bodyHtml: string | null
  bodyText: string | null
}) {
  const [showHtml, setShowHtml] = useState(Boolean(bodyHtml))
  const hasHtml = Boolean(bodyHtml)

  if (!bodyHtml && !bodyText) {
    return <div style={{ color: '#aaa', fontSize: 13, padding: '8px 0' }}>(empty body)</div>
  }

  return (
    <div>
      {hasHtml && bodyText && (
        <div style={{ marginBottom: 8, textAlign: 'right' }}>
          <button
            type="button"
            onClick={() => setShowHtml((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 11,
              color: '#888',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {showHtml ? 'Show plain text' : 'Show HTML'}
          </button>
        </div>
      )}
      {showHtml && bodyHtml ? (
        <div
          className="email-html-body"
          style={htmlBodyStyle}
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(bodyHtml, { ADD_ATTR: ['target'] }),
          }}
        />
      ) : (
        <div style={textBodyStyle}>{bodyText}</div>
      )}
    </div>
  )
}

const htmlBodyStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  padding: '8px 0',
  wordBreak: 'break-word',
}

const textBodyStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 13,
  lineHeight: 1.6,
  padding: '8px 0',
}
