import { afterEach, describe, expect, it } from 'vitest'
import type { JobMatcherEvalResult } from '../api'
import {
  clearJobMatcherEvalSessionsForWorkspace,
  getJobMatcherEvalPending,
  getJobMatcherEvalSession,
  getSessionScroll,
  resetSessionMemoryForTests,
  saveSessionScroll,
  sessionScrollKey,
  setJobMatcherEvalPending,
  setJobMatcherEvalSession,
} from './session-memory'

afterEach(() => {
  resetSessionMemoryForTests()
})

function fakeResult(id: string): JobMatcherEvalResult {
  return {
    intelligenceId: 'job-matcher',
    databaseWrites: 'NONE',
    autoAssignEnabled: false,
    dataset: {
      spec: {
        jobsMode: 'ALL',
        jobIds: [],
        sampling: 'TOTAL',
        count: 10,
        jobLifecycle: 'ALL',
      },
      summaryLabel: 'All Jobs',
      eligibleCount: 10,
      jobsInScope: 1,
      expectedMax: 10,
      sampleSizeRequested: 10,
      actualEvaluated: 10,
      capped: false,
      capReason: null,
    },
    metrics: {
      totalEvaluated: 10,
      correctMatches: 8,
      wrongMatches: 1,
      ambiguous: 0,
      conflict: 0,
      noMatch: 1,
      precision: 0.8,
      correctCoverage: 0.8,
      wrongMatchRate: 0.1,
      ambiguityRate: 0,
      conflictRate: 0,
      noMatchRate: 0.1,
    },
    jobBreakdown: [],
    rows: [
      {
        emailMessageId: id,
        subject: 's',
        direction: null,
        trueJobId: 'j1',
        trueJobName: 'Job',
        trueJobNumber: '1',
        jobAssignmentSource: null,
        predictedJobId: null,
        predictedJobName: null,
        predictedJobNumber: null,
        decision: 'NO_MATCH',
        outcome: 'NO_MATCH',
        resolvingMarker: null,
        evidence: [],
        markerTrace: [],
      },
    ],
    wrongMatches: [],
    groundTruthQuality: 'STRONG',
    groundTruthNotes: 'test',
  }
}

describe('session memory — navigation restore', () => {
  it('restores completed Job Matcher evaluation without rerun', () => {
    const result = fakeResult('msg_1')
    setJobMatcherEvalSession({
      workspaceId: 'ws_a',
      userId: 'u1',
      result,
      jobFilterId: null,
    })
    const restored = getJobMatcherEvalSession('ws_a', 'u1')
    expect(restored?.result.metrics.totalEvaluated).toBe(10)
    expect(restored?.result.rows[0]?.emailMessageId).toBe('msg_1')
  })

  it('isolates evaluation sessions by workspace', () => {
    setJobMatcherEvalSession({
      workspaceId: 'ws_a',
      userId: 'u1',
      result: fakeResult('a'),
    })
    expect(getJobMatcherEvalSession('ws_b', 'u1')).toBeNull()
    clearJobMatcherEvalSessionsForWorkspace('ws_a')
    expect(getJobMatcherEvalSession('ws_a', 'u1')).toBeNull()
  })

  it('tracks pending evaluation promise across remount', async () => {
    let resolve!: (v: JobMatcherEvalResult) => void
    const promise = new Promise<JobMatcherEvalResult>((r) => {
      resolve = r
    })
    setJobMatcherEvalPending({ workspaceId: 'ws_a', userId: 'u1', promise })
    expect(getJobMatcherEvalPending('ws_a', 'u1')).not.toBeNull()
    resolve(fakeResult('pending'))
    const evaluation = await promise
    setJobMatcherEvalSession({
      workspaceId: 'ws_a',
      userId: 'u1',
      result: evaluation,
    })
    expect(getJobMatcherEvalSession('ws_a', 'u1')?.result.rows[0]?.emailMessageId).toBe(
      'pending'
    )
  })

  it('saves and restores scroll positions scoped by surface', () => {
    const key = sessionScrollKey({
      workspaceId: 'ws_a',
      userId: 'u1',
      surface: 'inbox-list',
      context: 'conn_1',
    })
    saveSessionScroll(key, 420)
    expect(getSessionScroll(key)).toBe(420)
    expect(
      getSessionScroll(
        sessionScrollKey({
          workspaceId: 'ws_b',
          userId: 'u1',
          surface: 'inbox-list',
          context: 'conn_1',
        })
      )
    ).toBeNull()
  })
})
