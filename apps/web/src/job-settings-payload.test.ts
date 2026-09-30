import { describe, expect, it } from 'vitest'
import { jobSettingsUpdateBody } from './job-settings-payload'

describe('jobSettingsUpdateBody', () => {
  it('sends the description and converts calendar dates to ISO', () => {
    expect(jobSettingsUpdateBody({
      name: 'Nova Academy',
      jobNumber: '100',
      status: 'ACTIVE',
      description: 'Also known as: Nova Academy, NOVA',
      notes: '',
      startDate: '2026-09-24',
      targetCompletionDate: '2026-12-01',
    })).toEqual({
      name: 'Nova Academy',
      jobNumber: '100',
      status: 'ACTIVE',
      description: 'Also known as: Nova Academy, NOVA',
      notes: '',
      startDate: '2026-09-24T00:00:00.000Z',
      targetCompletionDate: '2026-12-01T00:00:00.000Z',
    })
  })

  it('clears description and dates when the fields are empty', () => {
    expect(jobSettingsUpdateBody({
      name: 'Nova Academy',
      jobNumber: '100',
      status: 'ACTIVE',
      description: '',
      notes: '',
      startDate: '',
      targetCompletionDate: '',
    })).toMatchObject({
      description: '',
      notes: '',
      startDate: null,
      targetCompletionDate: null,
    })
  })

  it('sends total cost and the three parties, and clears an empty cost', () => {
    expect(jobSettingsUpdateBody({
      name: 'Nova Academy',
      jobNumber: '26-184',
      status: 'BIDDING',
      description: '',
      notes: '',
      startDate: '',
      targetCompletionDate: '',
      totalCost: '$428,750',
      estimatorUserId: 'user-1',
      contractorCustomerId: 'cust-gc',
      clientCustomerId: 'cust-client',
    })).toMatchObject({
      status: 'BIDDING',
      totalCost: 428750,
      estimatorUserId: 'user-1',
      contractorCustomerId: 'cust-gc',
      clientCustomerId: 'cust-client',
    })

    expect(jobSettingsUpdateBody({
      name: 'Nova Academy',
      jobNumber: '26-184',
      status: 'ACTIVE',
      description: '',
      notes: '',
      startDate: '',
      targetCompletionDate: '',
      totalCost: '',
      estimatorUserId: '',
      contractorCustomerId: '',
      clientCustomerId: '',
    })).toMatchObject({
      totalCost: null,
      estimatorUserId: null,
      contractorCustomerId: null,
      clientCustomerId: null,
    })
  })

  it('sends site fields and clears blanks to null', () => {
    expect(jobSettingsUpdateBody({
      name: 'Nova Academy',
      jobNumber: '26-184',
      status: 'ACTIVE',
      description: '',
      notes: '',
      startDate: '',
      targetCompletionDate: '',
      siteName: 'Nova Site',
      siteAddress1: '100 Main',
      siteAddress2: '',
      siteCity: 'Denver',
      siteState: 'CO',
      sitePostalCode: '80202',
    })).toMatchObject({
      siteName: 'Nova Site',
      siteAddress1: '100 Main',
      siteAddress2: null,
      siteCity: 'Denver',
      siteState: 'CO',
      sitePostalCode: '80202',
    })
  })

  it('sends financial baselines and clears empty baselines to null (unknown)', () => {
    expect(jobSettingsUpdateBody({
      name: 'Nova Academy',
      jobNumber: '26-184',
      status: 'ACTIVE',
      description: '',
      notes: '',
      startDate: '',
      targetCompletionDate: '',
      originalContractValue: '$1,200,000',
      originalEstimatedCost: '900000',
    })).toMatchObject({
      originalContractValue: 1_200_000,
      originalEstimatedCost: 900_000,
    })

    expect(jobSettingsUpdateBody({
      name: 'Nova Academy',
      jobNumber: '26-184',
      status: 'ACTIVE',
      description: '',
      notes: '',
      startDate: '',
      targetCompletionDate: '',
      originalContractValue: '',
      originalEstimatedCost: '',
    })).toMatchObject({
      originalContractValue: null,
      originalEstimatedCost: null,
    })
  })
})
