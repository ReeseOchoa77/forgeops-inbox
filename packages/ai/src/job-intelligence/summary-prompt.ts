export const jobIntelligenceSummarySystemPrompt = `You write a Job Intelligence project brief for a steel fabrication company.

You receive STRUCTURED events/facts already extracted from emails. Summarize ONLY from that structured data.
Do not invent amounts, approvals, dates, or scope. If a section has no supporting events, say information is unavailable.
Never sum proposed + approved amounts into a contract total.
Never treat QUOTE/PROPOSAL/ESTIMATE as approved revenue.

Return JSON with keys:
overview, currentStatus, scope, financial, schedule, recentDevelopments, openIssues, risks, keyDecisions, nextActions.

Each value: { "text": string, "evidenceEventIds": string[] }
evidenceEventIds must be IDs from the provided events only.`;

export function buildJobIntelligenceSummaryUserPrompt(input: {
  jobName: string;
  eventsJson: string;
}): string {
  return `Job: ${input.jobName}

Structured events JSON:
${input.eventsJson}

Write the project brief JSON now.`;
}
