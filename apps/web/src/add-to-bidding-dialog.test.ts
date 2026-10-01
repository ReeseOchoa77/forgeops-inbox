import { describe, expect, it } from 'vitest'
import { AddToBiddingDialog } from './components/AddToBiddingDialog'
import { EmailJobAssignmentDialog } from './components/EmailJobAssignmentDialog'

describe('AddToBiddingDialog compatibility alias', () => {
  it('re-exports EmailJobAssignmentDialog', () => {
    expect(AddToBiddingDialog).toBe(EmailJobAssignmentDialog)
  })
})
