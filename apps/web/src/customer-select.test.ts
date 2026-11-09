import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canOfferCreateCustomer,
  filterCustomersByQuery,
  findExactCustomerNameMatch,
  findNormalizedCustomerNameMatch,
} from './customer-select'

const customers = [
  { id: '1', name: 'Mortenson', normalizedName: 'mortenson' },
  { id: '2', name: 'ABC Steel Construction', normalizedName: 'abc steel' },
  { id: '3', name: 'Ryan Companies', normalizedName: 'ryan' },
]

describe('customer select-or-create helpers', () => {
  it('filters customers by substring query', () => {
    expect(filterCustomersByQuery(customers, 'mort').map((c) => c.id)).toEqual(['1'])
    expect(filterCustomersByQuery(customers, 'STEEL').map((c) => c.id)).toEqual(['2'])
  })

  it('finds exact case-insensitive display-name matches', () => {
    expect(findExactCustomerNameMatch(customers, '  mortenson  ')?.id).toBe('1')
    expect(findExactCustomerNameMatch(customers, 'Mortenson X')).toBeNull()
  })

  it('finds normalizedName collisions for create prevention', () => {
    expect(findNormalizedCustomerNameMatch(customers, 'Mortenson Construction')?.id).toBe('1')
  })

  it('offers Create only when no exact/normalized match exists', () => {
    expect(canOfferCreateCustomer(customers, 'Mortenson')).toBe(false)
    expect(canOfferCreateCustomer(customers, 'Mortenson Construction')).toBe(false)
    expect(canOfferCreateCustomer(customers, 'Brand New GC')).toBe(true)
    expect(canOfferCreateCustomer(customers, '  ')).toBe(false)
  })

  it('does not auto-merge fuzzy-similar distinct names', () => {
    expect(findExactCustomerNameMatch(customers, 'Ryan')).toBeNull()
    expect(canOfferCreateCustomer(customers, 'Ryan Builders LLC')).toBe(true)
  })
})

describe('CustomerSelectOrCreate wiring', () => {
  const here = import.meta.dirname
  const componentSrc = readFileSync(join(here, 'components/CustomerSelectOrCreate.tsx'), 'utf8')
  const jobsSrc = readFileSync(join(here, 'views/JobsView.tsx'), 'utf8')
  const biddingSrc = readFileSync(join(here, 'views/BiddingView.tsx'), 'utf8')
  const bidDetailSrc = readFileSync(join(here, 'components/BidCandidateDetail.tsx'), 'utf8')
  const apiSrc = readFileSync(join(here, 'api.ts'), 'utf8')

  it('creates only via explicit Create action (api.createCustomer)', () => {
    expect(componentSrc).toContain('api.createCustomer')
    expect(componentSrc).toContain('+ Create')
    expect(componentSrc).toContain('Creating…')
    expect(componentSrc).not.toMatch(/createCustomer\(.*onChange/)
  })

  it('is reused on Jobs create, Jobs inline edit, Bid create, Bid edit, and convert', () => {
    expect(jobsSrc).toContain('CustomerSelectOrCreate')
    expect(biddingSrc).toContain('CustomerSelectOrCreate')
    expect(bidDetailSrc).toContain('CustomerSelectOrCreate')
    expect(bidDetailSrc.match(/CustomerSelectOrCreate/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('exposes create/get/update Customer API clients', () => {
    expect(apiSrc).toContain('createCustomer:')
    expect(apiSrc).toContain('getCustomer:')
    expect(apiSrc).toContain('updateCustomer:')
  })
})
