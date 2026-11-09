import { normalizeName } from '@forgeops/shared/reference/normalize'

export type CustomerSelectOption = {
  id: string
  name: string
  normalizedName?: string
}

/** Case-insensitive exact display-name match (trim). */
export function findExactCustomerNameMatch(
  customers: CustomerSelectOption[],
  query: string
): CustomerSelectOption | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  return customers.find((c) => c.name.trim().toLowerCase() === needle) ?? null
}

/**
 * Existing Customer that would collide on create via canonical normalizedName.
 * Prefer offering this instead of Create when present.
 */
export function findNormalizedCustomerNameMatch(
  customers: CustomerSelectOption[],
  query: string
): CustomerSelectOption | null {
  const normalized = normalizeName(query)
  if (!normalized) return null
  return (
    customers.find((c) => {
      const n = c.normalizedName ?? normalizeName(c.name)
      return n === normalized
    }) ?? null
  )
}

/** Substring filter for the combobox list (deterministic, case-insensitive). */
export function filterCustomersByQuery(
  customers: CustomerSelectOption[],
  query: string
): CustomerSelectOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return customers
  return customers.filter((c) => c.name.toLowerCase().includes(q))
}

/**
 * Show "+ Create" only when the trimmed query is non-empty and neither an
 * exact display-name nor a normalizedName match already exists.
 * Never creates on keystroke — caller must invoke Create explicitly.
 */
export function canOfferCreateCustomer(
  customers: CustomerSelectOption[],
  query: string
): boolean {
  const trimmed = query.trim()
  if (!trimmed) return false
  if (!normalizeName(trimmed)) return false
  if (findExactCustomerNameMatch(customers, trimmed)) return false
  if (findNormalizedCustomerNameMatch(customers, trimmed)) return false
  return true
}
