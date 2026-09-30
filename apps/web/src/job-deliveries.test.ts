import { describe, expect, it } from 'vitest'
import { rebuildDeliverySummary } from './views/JobDeliveriesView'
import type { JobDelivery } from './api'

describe('job deliveries UX helpers', () => {
  it('rebuilds Overview aggregates from delivery rows', () => {
    const deliveries = [
      {
        status: 'PLANNED',
        plannedDeliveryDate: '2026-10-18',
        deliveryNumber: 'DEL-1',
        id: '1',
        packages: [{ id: 'p1', name: 'Area A' }],
        risk: { lateToShip: false, lateDelivery: true, atRisk: true },
      },
      {
        status: 'IN_TRANSIT',
        plannedDeliveryDate: '2026-10-20',
        deliveryNumber: 'DEL-2',
        id: '2',
        packages: [],
        risk: { lateToShip: false, lateDelivery: false, atRisk: false },
      },
      {
        status: 'DELIVERED',
        plannedDeliveryDate: '2026-10-10',
        deliveryNumber: 'DEL-0',
        id: '0',
        packages: [],
        risk: { lateToShip: false, lateDelivery: false, atRisk: false },
      },
    ] as JobDelivery[]

    expect(rebuildDeliverySummary(deliveries)).toEqual({
      plannedCount: 1,
      inTransitCount: 1,
      lateCount: 1,
      nextDelivery: {
        id: '1',
        deliveryNumber: 'DEL-1',
        plannedDeliveryDate: '2026-10-18',
        packageNames: ['Area A'],
      },
    })
  })
})
