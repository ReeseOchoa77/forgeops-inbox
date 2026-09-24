export type JobListSortDir = "asc" | "desc"

export type JobListSort = {
  sortBy: string
  sortDir: JobListSortDir
}

export const DEFAULT_JOB_LIST_SORT: JobListSort = { sortBy: "createdAt", sortDir: "desc" }

export const JOB_LIST_SORT_OPTIONS: Array<{ value: string; label: string; sortBy: string; sortDir: JobListSortDir }> = [
  { value: "createdAt:desc", label: "Recently added", sortBy: "createdAt", sortDir: "desc" },
  { value: "activity:desc", label: "Activity — Most Recent", sortBy: "activity", sortDir: "desc" },
  { value: "activity:asc", label: "Activity — Oldest", sortBy: "activity", sortDir: "asc" },
  { value: "startDate:desc", label: "Start Date — Newest", sortBy: "startDate", sortDir: "desc" },
  { value: "startDate:asc", label: "Start Date — Oldest", sortBy: "startDate", sortDir: "asc" },
  { value: "totalCost:desc", label: "Cost — High to Low", sortBy: "totalCost", sortDir: "desc" },
  { value: "totalCost:asc", label: "Cost — Low to High", sortBy: "totalCost", sortDir: "asc" },
  { value: "name:asc", label: "Name — A to Z", sortBy: "name", sortDir: "asc" },
  { value: "name:desc", label: "Name — Z to A", sortBy: "name", sortDir: "desc" },
]

let currentSort: JobListSort = { ...DEFAULT_JOB_LIST_SORT }

export function getJobListSort(): JobListSort {
  return { ...currentSort }
}

export function setJobListSort(next: JobListSort): void {
  currentSort = { sortBy: next.sortBy, sortDir: next.sortDir }
}

export function resetJobListSortForTests(): void {
  currentSort = { ...DEFAULT_JOB_LIST_SORT }
}

export function jobListSortValue(sort: JobListSort): string {
  return `${sort.sortBy}:${sort.sortDir}`
}

export function jobListSortFromValue(value: string): JobListSort {
  const match = JOB_LIST_SORT_OPTIONS.find((option) => option.value === value)
  if (!match) return { ...DEFAULT_JOB_LIST_SORT }
  return { sortBy: match.sortBy, sortDir: match.sortDir }
}
