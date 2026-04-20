export interface RequestInboxSyncCommand {
  workspaceId: string;
  inboxConnectionId: string;
  initiatedBy?: string;
}

export interface InboxSyncDispatcher {
  dispatch(command: RequestInboxSyncCommand): Promise<string>;
}
