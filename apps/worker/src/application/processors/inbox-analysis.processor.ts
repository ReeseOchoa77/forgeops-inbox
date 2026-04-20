import type { Prisma, PrismaClient } from "@prisma/client";
import type { InboxAnalysisResult } from "@forgeops/shared";

import { analyzeInboxConnection } from "../services/analyze-inbox-connection.js";
import type { InboxAnalysisContext } from "../../domain/inbox-analysis-context.js";

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

const logAuditEvent = async (input: {
  prisma: PrismaClient;
  workspaceId: string;
  actorUserId?: string;
  connectionId: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  await input.prisma.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      entityType: "INBOX_CONNECTION",
      entityId: input.connectionId,
      action: input.action,
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {})
    }
  });
};

export class InboxAnalysisProcessor {
  constructor(private readonly prisma: PrismaClient) {}

  async process(context: InboxAnalysisContext): Promise<InboxAnalysisResult> {
    const connection = await this.prisma.inboxConnection.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: context.workspaceId,
          id: context.inboxConnectionId
        }
      },
      select: {
        id: true
      }
    });

    if (!connection) {
      throw new Error("Inbox connection not found for analysis");
    }

    await logAuditEvent({
      prisma: this.prisma,
      workspaceId: context.workspaceId,
      connectionId: connection.id,
      action: "inbox_connection.analysis_started",
      ...(context.initiatedBy ? { actorUserId: context.initiatedBy } : {}),
      metadata: {
        jobId: context.jobId
      }
    });

    try {
      const result = await analyzeInboxConnection({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        inboxConnectionId: context.inboxConnectionId
      });

      await logAuditEvent({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        connectionId: connection.id,
        action: "inbox_connection.analysis_succeeded",
        ...(context.initiatedBy ? { actorUserId: context.initiatedBy } : {}),
        metadata: {
          jobId: context.jobId,
          ...result
        }
      });

      console.info("inbox-analysis-completed", {
        jobId: context.jobId,
        ...result
      });

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown inbox analysis error";

      await logAuditEvent({
        prisma: this.prisma,
        workspaceId: context.workspaceId,
        connectionId: connection.id,
        action: "inbox_connection.analysis_failed",
        ...(context.initiatedBy ? { actorUserId: context.initiatedBy } : {}),
        metadata: {
          jobId: context.jobId,
          error: message
        }
      });

      console.error("inbox-analysis-failed", {
        jobId: context.jobId,
        workspaceId: context.workspaceId,
        inboxConnectionId: connection.id,
        error: message
      });

      throw error;
    }
  }
}
