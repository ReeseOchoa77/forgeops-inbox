/** Jobs search waits this long after the last keystroke before calling the API. */
export const JOBS_SEARCH_DEBOUNCE_MS = 300

/** A slower response must not replace results from a newer search. */
export function isCurrentJobsRequest(responseSeq: number, latestSeq: number): boolean {
  return responseSeq === latestSeq
}
