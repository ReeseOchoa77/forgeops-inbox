import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";

export interface AuditEventInput {
  workspaceId: string;
  actorUserId?: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Record<string, unknown>;
  request?: FastifyRequest;
}

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

export class AuditEventLogger {
  constructor(private readonly prisma: PrismaClient) {}

  async log(input: AuditEventInput): Promise<void> {
    const userAgentHeader = input.request?.headers["user-agent"];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader.join(", ")
      : userAgentHeader;
    const data = {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      ipAddress: input.request?.ip ?? null,
      userAgent: userAgent ?? null,
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {})
    };

    await this.prisma.auditEvent.create({
      data
    });
  }
}
