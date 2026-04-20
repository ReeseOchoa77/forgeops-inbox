import type { InboxSyncDispatcher } from "../../domain/services/inbox-sync-dispatcher.js";
import type { RequestInboxSyncCommand } from "../../domain/services/inbox-sync-dispatcher.js";

export class RequestInboxSyncUseCase {
  constructor(private readonly dispatcher: InboxSyncDispatcher) {}

  async execute(command: RequestInboxSyncCommand): Promise<{ jobId: string }> {
    const jobId = await this.dispatcher.dispatch(command);

    return { jobId };
  }
}

