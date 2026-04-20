import { QueueNames, type InboxSyncJobPayload } from "@forgeops/shared";
import { Queue, type JobsOptions } from "bullmq";

import type {
  InboxSyncDispatcher,
  RequestInboxSyncCommand
} from "../../domain/services/inbox-sync-dispatcher.js";

export const inboxSyncJobOptions: JobsOptions = {
  attempts: 3,
  removeOnComplete: 250,
  removeOnFail: 500,
  backoff: {
    type: "exponential",
    delay: 5_000
  }
};

export class BullMQInboxSyncDispatcher implements InboxSyncDispatcher {
  constructor(private readonly queue: Queue) {}

  async dispatch(command: RequestInboxSyncCommand): Promise<string> {
    const job = await this.queue.add(
      QueueNames.INBOX_SYNC,
      command,
      inboxSyncJobOptions
    );

    if (!job.id) {
      throw new Error("BullMQ did not return a job identifier");
    }

    return String(job.id);
  }
}
