import type { JobsOptions } from "bullmq";

export const inboxAnalysisJobOptions: JobsOptions = {
  attempts: 2,
  removeOnComplete: 250,
  removeOnFail: 500,
  backoff: {
    type: "exponential",
    delay: 3_000
  }
};
