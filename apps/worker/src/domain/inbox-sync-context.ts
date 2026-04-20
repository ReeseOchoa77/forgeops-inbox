import type { InboxSyncJobPayload } from "@forgeops/shared";

export interface InboxSyncContext extends InboxSyncJobPayload {
  jobId: string;
}

