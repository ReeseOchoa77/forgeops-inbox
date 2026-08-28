import type { Prisma, PrismaClient } from "@prisma/client";
import { sanitizeAuditMetadata } from "@forgeops/shared";
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

    let metadataJson: Prisma.InputJsonValue | undefined;
    if (input.metadata) {
      const sanitized = sanitizeAuditMetadata(input.metadata, {
        onWarn: ({ byteLength, truncated, strippedKeys }) => {
          console.warn("audit-metadata-oversized", {
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId,
            workspaceId: input.workspaceId,
            byteLength,
            truncated,
            strippedKeys: strippedKeys.slice(0, 20),
          });
        },
      });
      metadataJson = toPrismaJson(sanitized.metadata);
    }

    const data = {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      ipAddress: input.request?.ip ?? null,
      userAgent: userAgent ?? null,
      ...(metadataJson !== undefined ? { metadata: metadataJson } : {}),
    };

    await this.prisma.auditEvent.create({
      data,
    });
  }
}
