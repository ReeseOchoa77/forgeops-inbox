/**
 * Tasks created from an email follow that email's job.
 * Job → Tasks reads Task.jobId, so a job on the email alone is not enough.
 */
export function tasksForEmailJobLink(input: {
  workspaceId: string;
  sourceMessageIds: string[];
  jobId: string | null;
}): {
  where: { workspaceId: string; sourceMessageId: { in: string[] } };
  data: { jobId: string | null };
} | null {
  const sourceMessageIds = input.sourceMessageIds.filter((id) => id.length > 0);
  if (sourceMessageIds.length === 0) return null;
  return {
    where: {
      workspaceId: input.workspaceId,
      sourceMessageId: { in: sourceMessageIds },
    },
    data: { jobId: input.jobId },
  };
}
