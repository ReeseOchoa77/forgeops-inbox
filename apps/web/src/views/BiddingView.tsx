import { useEffect, useState } from 'react'
import { api, type BiddingProject } from '../api'
import { formatActivityAge, formatBidDue } from '../bidding-display'
import type { Breakpoint } from '../hooks/useBreakpoint'

type Props = {
  workspaceId: string
  onOpenBid: (jobId: string) => void
  breakpoint?: Breakpoint
}

export function BiddingView({ workspaceId, onOpenBid, breakpoint }: Props) {
  const isPhone = breakpoint === 'phone'
  const [search, setSearch] = useState('')
  const [due, setDue] = useState('all')
  const [sort, setSort] = useState('due')
  const [bids, setBids] = useState<BiddingProject[]>([])
  const [summary, setSummary] = useState({ active: 0, dueThisWeek: 0, pastDue: 0, unread: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true)
      api.getBidding(workspaceId, { search, due, sort })
        .then((res) => {
          setBids(res.bids)
          setSummary(res.summary)
          setError(null)
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load bids'))
        .finally(() => setLoading(false))
    }, search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [workspaceId, search, due, sort])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ padding: isPhone ? '14px 14px 8px' : '18px 22px 10px' }}>
        <div style={{ fontSize: 20, fontWeight: 680, color: '#111827' }}>Bidding</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
          Projects you are actively estimating. An email about bidding stays in the inbox until you add the project here.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <SummaryChip label="Active bids" value={summary.active} />
          <SummaryChip label="Due this week" value={summary.dueThisWeek} />
          <SummaryChip label="Past due" value={summary.pastDue} accent={summary.pastDue > 0 ? '#b42318' : undefined} />
          <SummaryChip label="Unread" value={summary.unread} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project, job number, or customer"
            style={{ flex: 1, minWidth: 180, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13 }}
          />
          <select value={due} onChange={(e) => setDue(e.target.value)} style={selectStyle}>
            <option value="all">All active bids</option>
            <option value="week">Due this week</option>
            <option value="month">Due this month</option>
            <option value="past">Past due</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={selectStyle}>
            <option value="due">Bid due soonest</option>
            <option value="activity">Recent activity</option>
            <option value="name">Project name</option>
          </select>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: isPhone ? '0 14px 16px' : '0 22px 18px' }}>
        {error && <div style={{ color: '#b42318', fontSize: 13, marginBottom: 8 }}>{error}</div>}
        {loading && bids.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13 }}>Loading bids…</div>
        ) : bids.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0' }}>
            No active bids. Open an email and choose Add to Bidding when you decide to pursue a project.
          </div>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
            {bids.map((bid) => {
              const dueLabel = formatBidDue(bid.bidDueAt)
              return (
                <button
                  key={bid.id}
                  type="button"
                  onClick={() => onOpenBid(bid.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isPhone ? '1fr auto' : 'minmax(180px, 1.4fr) minmax(140px, 1fr) 120px 110px auto',
                    gap: 10,
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    border: 'none',
                    borderBottom: '1px solid #f3f4f6',
                    background: '#fff',
                    cursor: 'pointer',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 650, color: '#111827' }}>{bid.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {[bid.customerName, bid.jobNumber ? `Job #${bid.jobNumber}` : ''].filter(Boolean).join(' · ') || 'No customer yet'}
                    </div>
                  </div>
                  {!isPhone && (
                    <div style={{ fontSize: 13, color: dueLabel.past ? '#b42318' : '#111827', fontWeight: 600 }}>
                      {dueLabel.label}
                    </div>
                  )}
                  {!isPhone && (
                    <div style={{ fontSize: 12, color: '#374151' }}>
                      {bid.threadCount} {bid.threadCount === 1 ? 'thread' : 'threads'}
                      {bid.unreadCount > 0 ? ` · ${bid.unreadCount} unread` : ''}
                    </div>
                  )}
                  {!isPhone && (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {formatActivityAge(bid.lastActivityAt)}
                      {bid.recentSender ? ` · ${bid.recentSender}` : ''}
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 650, color: '#1d4ed8' }}>Open</div>
                  {isPhone && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 12, color: dueLabel.past ? '#b42318' : '#374151' }}>
                      {dueLabel.label} · {bid.threadCount} threads
                      {bid.unreadCount > 0 ? ` · ${bid.unreadCount} unread` : ''} · {formatActivityAge(bid.lastActivityAt)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryChip({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div style={{
      padding: '6px 10px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb',
      minWidth: 88,
    }}>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent ?? '#111827' }}>{value}</div>
    </div>
  )
}

const selectStyle = {
  padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: 13, background: '#fff',
}
