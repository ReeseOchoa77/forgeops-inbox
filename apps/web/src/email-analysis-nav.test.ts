import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname

function navItemIndexes(app: string) {
  const review = app.indexOf("page: 'review'")
  const emailAnalysis = app.indexOf("page: 'email-analysis'")
  const workerJobs = app.indexOf("page: 'worker-jobs'")
  const platformAdmin = app.indexOf("page: 'admin'")
  return { review, emailAnalysis, workerJobs, platformAdmin }
}

describe('Email Analysis Systems navigation', () => {
  it('places Email Analysis in Systems between Email Classification and Worker Jobs', () => {
    const app = readFileSync(join(here, 'App.tsx'), 'utf8')
    const { review, emailAnalysis, workerJobs, platformAdmin } = navItemIndexes(app)
    expect(review).toBeGreaterThan(-1)
    expect(emailAnalysis).toBeGreaterThan(review)
    expect(workerJobs).toBeGreaterThan(emailAnalysis)
    expect(platformAdmin).toBeGreaterThan(workerJobs)
    expect(app).toContain("label: 'Email Analysis'")
    expect(app).toContain("section: 'System'")
    // Exactly one Email Analysis nav entry
    expect(app.split("label: 'Email Analysis'").length - 1).toBe(1)
    expect(app.split("page: 'email-analysis'").length - 1).toBe(1)
  })

  it('keeps Worker Jobs and Platform Admin as adminOnly System items with routes', () => {
    const app = readFileSync(join(here, 'App.tsx'), 'utf8')
    expect(app).toContain("label: 'Worker Jobs'")
    expect(app).toContain("label: 'Platform Admin'")
    expect(app).toMatch(
      /\{\s*page:\s*'worker-jobs',\s*label:\s*'Worker Jobs'[\s\S]*?adminOnly:\s*true/
    )
    expect(app).toMatch(
      /\{\s*page:\s*'admin',\s*label:\s*'Platform Admin'[\s\S]*?adminOnly:\s*true/
    )
    expect(app).toContain("page === 'worker-jobs' && canSeePlatformOperatorNav")
    expect(app).toContain("page === 'admin' && canSeePlatformOperatorNav")
    expect(app).toContain('<WorkerJobsView')
    expect(app).toContain('<PlatformAdminView')
  })

  it('removes Email Analysis tab from Workspace; keeps Monitored Mailboxes and Team Access', () => {
    const workspace = readFileSync(join(here, 'views/WorkspaceView.tsx'), 'utf8')
    expect(workspace).not.toContain("label: 'Email Analysis'")
    expect(workspace).not.toContain("id: 'folders'")
    expect(workspace).not.toContain('FoldersView')
    expect(workspace).toContain("id: 'mailboxes'")
    expect(workspace).toContain("label: 'Monitored Mailboxes'")
    expect(workspace).toContain("id: 'team'")
    expect(workspace).toContain("label: 'Team Access'")

    const app = readFileSync(join(here, 'App.tsx'), 'utf8')
    expect(app).toContain("setPage('email-analysis')")
    expect(app).toContain('EmailAnalysisView')
    // No duplicate Email Analysis under Workspace page title wiring
    expect(app).not.toContain("setWorkspaceTabHint('folders')")
  })

  it('keeps Project vs Bidding modes under Email Analysis', () => {
    const view = readFileSync(join(here, 'views/EmailAnalysisView.tsx'), 'utf8')
    expect(view).toContain('Project Folder Analysis')
    expect(view).toContain('Bidding Folder Analysis')
    expect(view).toContain('FoldersView')
    expect(view).toContain('BiddingFolderAnalysisView')
  })

  it('Bidding Folder Analysis supports scan → analyze → candidates → create bid', () => {
    const view = readFileSync(join(here, 'views/BiddingFolderAnalysisView.tsx'), 'utf8')
    expect(view).toContain('Scan Bidding Folders')
    expect(view).toContain('Analyze Discovered Emails')
    expect(view).toContain('Bid Candidates')
    expect(view).toContain("startRun('analyze')")
    expect(view).toContain('Create Bid')
    expect(view).toContain('MATCH EVIDENCE')
    expect(view).toContain('promoteBidCandidate')
    expect(view).toContain('rejectBidCandidate')
  })
})
