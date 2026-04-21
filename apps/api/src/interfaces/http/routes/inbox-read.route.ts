import {
  Prisma,
  type EmailType
} from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const DEFAULT_CONFIDENCE_THRESHOLD = new Prisma.Decimal("0.75");

const businessCategoryValues = ["BUSINESS", "NON_BUSINESS"] as const;

const emailTypeValues = [
  "ACTIONABLE_REQUEST",
  "FYI_UPDATE",
  "SALES_MARKETING",
  "SUPPORT_CUSTOMER_ISSUE",
  "RECRUITING_HIRING",
  "INTERNAL_COORDINATION",
  "NEEDS_REVIEW"
] as const;

const priorityValues = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const itemStatusValues = [
  "NEW",
  "NEEDS_REVIEW",
  "ROUTED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "ARCHIVED"
] as const;
const taskStatusValues = [
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED"
] as const;
const reviewQueueValues = ["TRIAGE", "EXTRACTION", "ROUTING", "QA"] as const;
const reviewStatusValues = [
  "NOT_REQUIRED",
  "PENDING",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED"
] as const;
const reviewReasonValues = [
  "message_needs_review",
  "classification_requires_review",
  "classification_low_confidence",
  "task_requires_review",
  "task_low_confidence"
] as const;

const booleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const booleanQueryWithDefaultFalseSchema = z
  .enum(["true", "false"])
  .optional()
  .default("false")
  .transform((value) => value === "true");

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
});

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1)
});

const workspaceConnectionParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1)
});

const messageDetailParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
  messageId: z.string().min(1)
});

const messagesListQuerySchema = paginationQuerySchema.extend({
  businessCategory: z.enum(businessCategoryValues).optional(),
  classificationType: z.enum(emailTypeValues).optional(),
  reviewOnly: booleanQueryWithDefaultFalseSchema,
  lowConfidenceOnly: booleanQueryWithDefaultFalseSchema,
  hasTaskCandidate: booleanQuerySchema.optional(),
  search: z.string().min(1).optional()
});

const tasksListQuerySchema = paginationQuerySchema.extend({
  reviewOnly: booleanQueryWithDefaultFalseSchema,
  lowConfidenceOnly: booleanQueryWithDefaultFalseSchema,
  status: z.enum(taskStatusValues).optional()
});

const reviewListQuerySchema = paginationQuerySchema;

const storedAddressSchema = z.object({
  name: z.string().nullable(),
  email: z.string().email(),
  raw: z.string().optional()
});

const normalizedParticipantSchema = z.object({
  name: z.string().nullable(),
  email: z.string().email(),
  role: z.enum(["FROM", "TO", "CC", "BCC", "REPLY_TO"])
});

const attachmentMetadataSchema = z.object({
  attachmentId: z.string().nullable(),
  contentId: z.string().nullable(),
  filename: z.string().nullable(),
  inline: z.boolean(),
  mimeType: z.string().nullable(),
  partId: z.string().nullable(),
  size: z.number().nullable()
});

const connectionSummarySchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().nullable(),
  providerAccountId: z.string().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH", "DISCONNECTED"]),
  connectedAt: z.string().datetime().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  grantedScopes: z.array(z.string().min(1)),
  counts: z.object({
    messages: z.number().int().nonnegative(),
    threads: z.number().int().nonnegative()
  })
});

const classificationSummarySchema = z.object({
  id: z.string().min(1),
  businessCategory: z.enum(businessCategoryValues).nullable(),
  emailType: z.enum(emailTypeValues),
  priority: z.enum(priorityValues).nullable(),
  itemStatus: z.enum(itemStatusValues).nullable(),
  summary: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  requiresReview: z.boolean(),
  reviewQueue: z.enum(reviewQueueValues).nullable(),
  reviewStatus: z.enum(reviewStatusValues),
  containsActionRequest: z.boolean(),
  deadline: z.string().datetime().nullable(),
  routingHints: z.unknown().nullable(),
  extractedFields: z.unknown().nullable()
});

const taskSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  assigneeGuess: z.string().nullable(),
  dueAt: z.string().datetime().nullable(),
  priority: z.enum(priorityValues),
  status: z.enum(taskStatusValues),
  confidence: z.number().min(0).max(1),
  requiresReview: z.boolean(),
  reviewQueue: z.enum(reviewQueueValues).nullable(),
  reviewStatus: z.enum(reviewStatusValues),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const messageSummarySchema = z.object({
  id: z.string().min(1),
  providerMessageId: z.string().min(1),
  providerThreadId: z.string().min(1),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  senderName: z.string().nullable(),
  senderEmail: z.string().email(),
  receivedAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime(),
  priority: z.enum(priorityValues).nullable(),
  itemStatus: z.enum(itemStatusValues),
  classification: classificationSummarySchema.nullable(),
  taskCandidate: taskSummarySchema.nullable()
});

const normalizedEmailDetailSchema = z.object({
  id: z.string().min(1),
  sender: normalizedParticipantSchema,
  recipients: z.array(normalizedParticipantSchema),
  subject: z.string().nullable(),
  normalizedSubject: z.string().nullable(),
  snippet: z.string().nullable(),
  receivedAt: z.string().datetime().nullable(),
  cleanTextBody: z.string().nullable(),
  labelHints: z.array(z.string().min(1)),
  categoryHints: z.array(z.string().min(1)),
  senderDomain: z.string().nullable()
});

const messageDetailSchema = z.object({
  message: z.object({
    id: z.string().min(1),
    providerMessageId: z.string().min(1),
    providerThreadId: z.string().min(1),
    subject: z.string().nullable(),
    senderName: z.string().nullable(),
    senderEmail: z.string().email(),
    toAddresses: z.array(storedAddressSchema),
    ccAddresses: z.array(storedAddressSchema),
    bccAddresses: z.array(storedAddressSchema),
    replyToAddresses: z.array(storedAddressSchema),
    snippet: z.string().nullable(),
    bodyText: z.string().nullable(),
    labelIds: z.array(z.string().min(1)),
    hasAttachments: z.boolean(),
    attachmentMetadata: z.array(attachmentMetadataSchema),
    sentAt: z.string().datetime(),
    receivedAt: z.string().datetime().nullable(),
    priority: z.enum(priorityValues).nullable(),
    itemStatus: z.enum(itemStatusValues)
  }),
  thread: z.object({
    id: z.string().min(1),
    providerThreadId: z.string().min(1),
    subject: z.string().nullable(),
    normalizedSubject: z.string().nullable(),
    snippet: z.string().nullable(),
    lastMessageAt: z.string().datetime().nullable(),
    messageCount: z.number().int().nonnegative(),
    reviewQueue: z.enum(reviewQueueValues).nullable(),
    reviewStatus: z.enum(reviewStatusValues)
  }),
  normalizedEmail: normalizedEmailDetailSchema.nullable(),
  classification: classificationSummarySchema.nullable(),
  taskCandidate: taskSummarySchema.nullable()
});

const reviewItemSchema = z.object({
  message: messageSummarySchema,
  reviewReasons: z.array(z.enum(reviewReasonValues)).min(1)
});

const taskListItemSchema = z.object({
  task: taskSummarySchema,
  sourceMessage: z
    .object({
      id: z.string().min(1),
      providerMessageId: z.string().min(1),
      subject: z.string().nullable(),
      snippet: z.string().nullable(),
      senderEmail: z.string().email(),
      receivedAt: z.string().datetime().nullable()
    })
    .nullable(),
  classification: classificationSummarySchema.nullable()
});

const connectionListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  connections: z.array(connectionSummarySchema)
});

const connectionDetailResponseSchema = z.object({
  workspaceId: z.string().min(1),
  connection: connectionSummarySchema
});

const messagesListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  filters: z.object({
    classificationType: z.enum(emailTypeValues).nullable(),
    reviewOnly: z.boolean(),
    lowConfidenceOnly: z.boolean(),
    hasTaskCandidate: z.boolean().nullable()
  }),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  }),
  messages: z.array(messageSummarySchema)
});

const messageDetailResponseSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  data: messageDetailSchema
});

const reviewListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  thresholds: z.object({
    classification: z.number().min(0).max(1),
    task: z.number().min(0).max(1)
  }),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  }),
  items: z.array(reviewItemSchema)
});

const tasksListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  filters: z.object({
    reviewOnly: z.boolean(),
    lowConfidenceOnly: z.boolean(),
    status: z.enum(taskStatusValues).nullable()
  }),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  }),
  tasks: z.array(taskListItemSchema)
});

const serializeDate = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

const serializeDecimal = (
  value: Prisma.Decimal | null | undefined
): number | null => (value ? Number(value.toString()) : null);

const parseStoredAddresses = (value: unknown) =>
  z.array(storedAddressSchema).parse(value ?? []);

const parseNormalizedParticipants = (value: unknown) =>
  z.array(normalizedParticipantSchema).parse(value ?? []);

const parseNormalizedSender = (value: unknown) =>
  normalizedParticipantSchema.parse(value);

const parseAttachmentMetadata = (value: unknown) =>
  z.array(attachmentMetadataSchema).parse(value ?? []);

const serializeConnection = (connection: {
  id: string;
  provider: string;
  email: string;
  displayName: string | null;
  providerAccountId: string | null;
  status: "ACTIVE" | "PAUSED" | "ERROR" | "REQUIRES_REAUTH" | "DISCONNECTED";
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  grantedScopes: string[];
  _count: {
    messages: number;
    threads: number;
  };
}) =>
  connectionSummarySchema.parse({
    id: connection.id,
    provider: connection.provider.toLowerCase(),
    email: connection.email,
    displayName: connection.displayName,
    providerAccountId: connection.providerAccountId,
    status: connection.status,
    connectedAt: serializeDate(connection.connectedAt),
    lastSyncedAt: serializeDate(connection.lastSyncedAt),
    grantedScopes: connection.grantedScopes,
    counts: {
      messages: connection._count.messages,
      threads: connection._count.threads
    }
  });

const serializeClassification = (classification: {
  id: string;
  businessCategory: (typeof businessCategoryValues)[number] | null;
  emailType: EmailType;
  priority: (typeof priorityValues)[number] | null;
  itemStatus: (typeof itemStatusValues)[number] | null;
  summary: string | null;
  confidence: Prisma.Decimal;
  requiresReview: boolean;
  reviewQueue: (typeof reviewQueueValues)[number] | null;
  reviewStatus: (typeof reviewStatusValues)[number];
  containsActionRequest: boolean;
  deadline: Date | null;
  routingHints: unknown;
  extractedFields: unknown;
} | null) =>
  classification
    ? classificationSummarySchema.parse({
        id: classification.id,
        businessCategory: classification.businessCategory,
        emailType: classification.emailType,
        priority: classification.priority,
        itemStatus: classification.itemStatus,
        summary: classification.summary,
        confidence: serializeDecimal(classification.confidence),
        requiresReview: classification.requiresReview,
        reviewQueue: classification.reviewQueue,
        reviewStatus: classification.reviewStatus,
        containsActionRequest: classification.containsActionRequest,
        deadline: serializeDate(classification.deadline),
        routingHints: classification.routingHints ?? null,
        extractedFields: classification.extractedFields ?? null
      })
    : null;

const serializeTask = (task: {
  id: string;
  title: string;
  summary: string | null;
  description: string | null;
  assigneeGuess: string | null;
  dueAt: Date | null;
  priority: (typeof priorityValues)[number];
  status: (typeof taskStatusValues)[number];
  confidence: Prisma.Decimal;
  requiresReview: boolean;
  reviewQueue: (typeof reviewQueueValues)[number] | null;
  reviewStatus: (typeof reviewStatusValues)[number];
  createdAt: Date;
  updatedAt: Date;
} | null) =>
  task
    ? taskSummarySchema.parse({
        id: task.id,
        title: task.title,
        summary: task.summary,
        description: task.description,
        assigneeGuess: task.assigneeGuess,
        dueAt: serializeDate(task.dueAt),
        priority: task.priority,
        status: task.status,
        confidence: serializeDecimal(task.confidence),
        requiresReview: task.requiresReview,
        reviewQueue: task.reviewQueue,
        reviewStatus: task.reviewStatus,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString()
      })
    : null;

const serializeMessageSummary = (message: {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  snippet: string | null;
  senderName: string | null;
  senderEmail: string;
  receivedAt: Date | null;
  sentAt: Date;
  priority: (typeof priorityValues)[number] | null;
  itemStatus: (typeof itemStatusValues)[number];
  classifications: Array<Parameters<typeof serializeClassification>[0]>;
  tasks: Array<Parameters<typeof serializeTask>[0]>;
}) =>
  messageSummarySchema.parse({
    id: message.id,
    providerMessageId: message.gmailMessageId,
    providerThreadId: message.gmailThreadId,
    subject: message.subject,
    snippet: message.snippet,
    senderName: message.senderName,
    senderEmail: message.senderEmail,
    receivedAt: serializeDate(message.receivedAt),
    sentAt: message.sentAt.toISOString(),
    priority: message.priority,
    itemStatus: message.itemStatus,
    classification: serializeClassification(message.classifications[0] ?? null),
    taskCandidate: serializeTask(message.tasks[0] ?? null)
  });

const getWorkspaceThresholds = async (
  app: FastifyInstance,
  workspaceId: string
): Promise<{
  classificationThreshold: Prisma.Decimal;
  taskThreshold: Prisma.Decimal;
}> => {
  const setting = await app.services.prisma.workspaceSetting.findUnique({
    where: {
      workspaceId
    },
    select: {
      classificationConfidenceThreshold: true,
      taskConfidenceThreshold: true
    }
  });

  return {
    classificationThreshold:
      setting?.classificationConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    taskThreshold:
      setting?.taskConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
  };
};

const buildReviewMessageConditions = (input: {
  classificationThreshold: Prisma.Decimal;
  taskThreshold: Prisma.Decimal;
}): Prisma.EmailMessageWhereInput => ({
  OR: [
    {
      itemStatus: "NEEDS_REVIEW"
    },
    {
      classifications: {
        some: {
          OR: [
            { requiresReview: true },
            { itemStatus: "NEEDS_REVIEW" },
            { reviewStatus: { in: ["PENDING", "IN_REVIEW"] } },
            { confidence: { lt: input.classificationThreshold } }
          ]
        }
      }
    },
    {
      tasks: {
        some: {
          OR: [
            { requiresReview: true },
            { reviewStatus: { in: ["PENDING", "IN_REVIEW"] } },
            { confidence: { lt: input.taskThreshold } }
          ]
        }
      }
    }
  ]
});

const buildMessagesWhere = (input: {
  workspaceId: string;
  inboxConnectionId: string;
  businessCategory?: (typeof businessCategoryValues)[number];
  classificationType?: EmailType;
  reviewOnly: boolean;
  lowConfidenceOnly: boolean;
  hasTaskCandidate?: boolean;
  search?: string;
  classificationThreshold: Prisma.Decimal;
  taskThreshold: Prisma.Decimal;
}): Prisma.EmailMessageWhereInput => {
  const andConditions: Prisma.EmailMessageWhereInput[] = [
    {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId
    }
  ];

  if (input.search) {
    const term = input.search.trim();
    andConditions.push({
      OR: [
        { subject: { contains: term, mode: "insensitive" } },
        { senderEmail: { contains: term, mode: "insensitive" } },
        { senderName: { contains: term, mode: "insensitive" } },
        { snippet: { contains: term, mode: "insensitive" } },
        { bodyText: { contains: term, mode: "insensitive" } }
      ]
    });
  }

  if (input.businessCategory) {
    andConditions.push({
      classifications: {
        some: {
          businessCategory: input.businessCategory
        }
      }
    });
  }

  if (input.classificationType) {
    andConditions.push({
      classifications: {
        some: {
          emailType: input.classificationType
        }
      }
    });
  }

  if (typeof input.hasTaskCandidate === "boolean") {
    andConditions.push(
      input.hasTaskCandidate
        ? {
            tasks: {
              some: {}
            }
          }
        : {
            tasks: {
              none: {}
            }
          }
    );
  }

  if (input.reviewOnly) {
    andConditions.push(
      buildReviewMessageConditions({
        classificationThreshold: input.classificationThreshold,
        taskThreshold: input.taskThreshold
      })
    );
  }

  if (input.lowConfidenceOnly) {
    andConditions.push({
      OR: [
        {
          classifications: {
            some: {
              confidence: {
                lt: input.classificationThreshold
              }
            }
          }
        },
        {
          tasks: {
            some: {
              confidence: {
                lt: input.taskThreshold
              }
            }
          }
        }
      ]
    });
  }

  return {
    AND: andConditions
  };
};

const buildTasksWhere = (input: {
  workspaceId: string;
  inboxConnectionId: string;
  reviewOnly: boolean;
  lowConfidenceOnly: boolean;
  status?: (typeof taskStatusValues)[number];
  taskThreshold: Prisma.Decimal;
}): Prisma.TaskWhereInput => {
  const andConditions: Prisma.TaskWhereInput[] = [
    {
      workspaceId: input.workspaceId,
      sourceThread: {
        inboxConnectionId: input.inboxConnectionId
      }
    }
  ];

  if (input.status) {
    andConditions.push({
      status: input.status
    });
  }

  if (input.reviewOnly) {
    andConditions.push({
      OR: [
        { requiresReview: true },
        { reviewStatus: { in: ["PENDING", "IN_REVIEW"] } },
        { confidence: { lt: input.taskThreshold } }
      ]
    });
  }

  if (input.lowConfidenceOnly) {
    andConditions.push({
      confidence: {
        lt: input.taskThreshold
      }
    });
  }

  return {
    AND: andConditions
  };
};

const buildReviewReasons = (input: {
  messageItemStatus: (typeof itemStatusValues)[number];
  classification: ReturnType<typeof serializeClassification>;
  task: ReturnType<typeof serializeTask>;
  classificationThreshold: number;
  taskThreshold: number;
}): Array<(typeof reviewReasonValues)[number]> => {
  const reasons = new Set<(typeof reviewReasonValues)[number]>();

  if (
    input.messageItemStatus === "NEEDS_REVIEW" ||
    input.classification?.itemStatus === "NEEDS_REVIEW"
  ) {
    reasons.add("message_needs_review");
  }

  if (
    input.classification?.requiresReview ||
    input.classification?.reviewStatus === "PENDING" ||
    input.classification?.reviewStatus === "IN_REVIEW"
  ) {
    reasons.add("classification_requires_review");
  }

  if (
    input.classification &&
    input.classification.confidence < input.classificationThreshold
  ) {
    reasons.add("classification_low_confidence");
  }

  if (
    input.task &&
    (input.task.requiresReview ||
      input.task.reviewStatus === "PENDING" ||
      input.task.reviewStatus === "IN_REVIEW")
  ) {
    reasons.add("task_requires_review");
  }

  if (input.task && input.task.confidence < input.taskThreshold) {
    reasons.add("task_low_confidence");
  }

  return [...reasons];
};

const sendAuthenticationRequired = (reply: FastifyReply) =>
  reply.code(401).send({
    message: "Authentication required"
  });

const sendWorkspaceAccessDenied = (reply: FastifyReply) =>
  reply.code(403).send({
    message: "Workspace access denied"
  });

const loadWorkspaceSession = async (input: {
  app: FastifyInstance;
  request: FastifyRequest;
  workspaceId: string;
}) => {
  const session = await getSessionFromRequest(input.request);

  if (!session) {
    return {
      session: null,
      membership: null
    };
  }

  const membership = await requireWorkspaceMembership(
    input.app.services.prisma,
    session.userId,
    input.workspaceId
  );

  return {
    session,
    membership
  };
};

const loadWorkspaceConnection = async (input: {
  app: FastifyInstance;
  workspaceId: string;
  inboxConnectionId: string;
}) =>
  input.app.services.prisma.inboxConnection.findFirst({
    where: {
      id: input.inboxConnectionId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true,
      provider: true,
      email: true,
      displayName: true,
      providerAccountId: true,
      status: true,
      connectedAt: true,
      lastSyncedAt: true,
      grantedScopes: true,
      _count: {
        select: {
          messages: true,
          threads: true
        }
      }
    }
  });

export const registerInboxReadRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get("/api/v1/workspaces/:workspaceId/inbox-connections", async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const { session, membership } = await loadWorkspaceSession({
      app,
      request,
      workspaceId: params.workspaceId
    });

    if (!session) {
      return sendAuthenticationRequired(reply);
    }

    if (!membership) {
      return sendWorkspaceAccessDenied(reply);
    }

    const connections = await app.services.prisma.inboxConnection.findMany({
      where: {
        workspaceId: params.workspaceId
      },
      orderBy: [
        {
          connectedAt: "desc"
        },
        {
          createdAt: "desc"
        }
      ],
      select: {
        id: true,
        provider: true,
        email: true,
        displayName: true,
        providerAccountId: true,
        status: true,
        connectedAt: true,
        lastSyncedAt: true,
        grantedScopes: true,
        _count: {
          select: {
            messages: true,
            threads: true
          }
        }
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: session.userId,
      entityType: "WORKSPACE",
      entityId: params.workspaceId,
      action: "workspace.inbox_connections_viewed",
      metadata: {
        count: connections.length
      },
      request
    });

    return reply.send(
      connectionListResponseSchema.parse({
        workspaceId: params.workspaceId,
        connections: connections.map(serializeConnection)
      })
    );
  });

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: connection.id,
        action: "inbox_connection.viewed",
        request
      });

      return reply.send(
        connectionDetailResponseSchema.parse({
          workspaceId: params.workspaceId,
          connection: serializeConnection(connection)
        })
      );
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const query = messagesListQuerySchema.parse(request.query);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const thresholds = await getWorkspaceThresholds(app, params.workspaceId);
      const where = buildMessagesWhere({
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        ...(query.businessCategory
          ? { businessCategory: query.businessCategory }
          : {}),
        ...(query.classificationType
          ? { classificationType: query.classificationType }
          : {}),
        reviewOnly: query.reviewOnly,
        lowConfidenceOnly: query.lowConfidenceOnly,
        ...(typeof query.hasTaskCandidate === "boolean"
          ? { hasTaskCandidate: query.hasTaskCandidate }
          : {}),
        ...(query.search ? { search: query.search } : {}),
        classificationThreshold: thresholds.classificationThreshold,
        taskThreshold: thresholds.taskThreshold
      });
      const skip = (query.page - 1) * query.pageSize;

      const [totalCount, messages] = await Promise.all([
        app.services.prisma.emailMessage.count({
          where
        }),
        app.services.prisma.emailMessage.findMany({
          where,
          orderBy: [
            { receivedAt: "desc" },
            { sentAt: "desc" },
            { createdAt: "desc" }
          ],
          skip,
          take: query.pageSize,
          select: {
            id: true,
            gmailMessageId: true,
            gmailThreadId: true,
            subject: true,
            snippet: true,
            senderName: true,
            senderEmail: true,
            receivedAt: true,
            sentAt: true,
            priority: true,
            itemStatus: true,
            classifications: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                businessCategory: true,
                emailType: true,
                priority: true,
                itemStatus: true,
                summary: true,
                confidence: true,
                requiresReview: true,
                reviewQueue: true,
                reviewStatus: true,
                containsActionRequest: true,
                deadline: true,
                routingHints: true,
                extractedFields: true
              }
            },
            tasks: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                title: true,
                summary: true,
                description: true,
                assigneeGuess: true,
                dueAt: true,
                priority: true,
                status: true,
                confidence: true,
                requiresReview: true,
                reviewQueue: true,
                reviewStatus: true,
                createdAt: true,
                updatedAt: true
              }
            }
          }
        })
      ]);

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.id,
        action: "inbox_connection.messages_viewed",
        metadata: {
          filters: {
            classificationType: query.classificationType ?? null,
            reviewOnly: query.reviewOnly,
            lowConfidenceOnly: query.lowConfidenceOnly,
            hasTaskCandidate: query.hasTaskCandidate ?? null
          },
          page: query.page,
          pageSize: query.pageSize
        },
        request
      });

      return reply.send(
        messagesListResponseSchema.parse({
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          filters: {
            classificationType: query.classificationType ?? null,
            reviewOnly: query.reviewOnly,
            lowConfidenceOnly: query.lowConfidenceOnly,
            hasTaskCandidate: query.hasTaskCandidate ?? null
          },
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            totalCount,
            totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize)
          },
          messages: messages.map(serializeMessageSummary)
        })
      );
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/:messageId",
    async (request, reply) => {
      const params = messageDetailParamsSchema.parse(request.params);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const message = await app.services.prisma.emailMessage.findFirst({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          OR: [
            {
              id: params.messageId
            },
            {
              gmailMessageId: params.messageId
            }
          ]
        },
        select: {
          id: true,
          gmailMessageId: true,
          gmailThreadId: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          toAddresses: true,
          ccAddresses: true,
          bccAddresses: true,
          replyToAddresses: true,
          snippet: true,
          bodyText: true,
          labelIds: true,
          hasAttachments: true,
          attachmentMetadata: true,
          sentAt: true,
          receivedAt: true,
          priority: true,
          itemStatus: true,
          thread: {
            select: {
              id: true,
              gmailThreadId: true,
              subject: true,
              normalizedSubject: true,
              snippet: true,
              lastMessageAt: true,
              messageCount: true,
              reviewQueue: true,
              reviewStatus: true
            }
          },
          normalizedEmail: {
            select: {
              id: true,
              sender: true,
              recipients: true,
              subject: true,
              normalizedSubject: true,
              snippet: true,
              receivedAt: true,
              cleanTextBody: true,
              labelHints: true,
              categoryHints: true,
              senderDomain: true
            }
          },
          classifications: {
            orderBy: {
              createdAt: "desc"
            },
            take: 1,
            select: {
              id: true,
              businessCategory: true,
              emailType: true,
              priority: true,
              itemStatus: true,
              summary: true,
              confidence: true,
              requiresReview: true,
              reviewQueue: true,
              reviewStatus: true,
              containsActionRequest: true,
              deadline: true,
              routingHints: true,
              extractedFields: true
            }
          },
          tasks: {
            orderBy: {
              createdAt: "desc"
            },
            take: 1,
            select: {
              id: true,
              title: true,
              summary: true,
              description: true,
              assigneeGuess: true,
              dueAt: true,
              priority: true,
              status: true,
              confidence: true,
              requiresReview: true,
              reviewQueue: true,
              reviewStatus: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      });

      if (!message) {
        return reply.code(404).send({
          message: "Message not found"
        });
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "EMAIL_MESSAGE",
        entityId: message.id,
        action: "email_message.viewed",
        request
      });

      return reply.send(
        messageDetailResponseSchema.parse({
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          data: {
            message: {
              id: message.id,
              providerMessageId: message.gmailMessageId,
              providerThreadId: message.gmailThreadId,
              subject: message.subject,
              senderName: message.senderName,
              senderEmail: message.senderEmail,
              toAddresses: parseStoredAddresses(message.toAddresses),
              ccAddresses: parseStoredAddresses(message.ccAddresses),
              bccAddresses: parseStoredAddresses(message.bccAddresses),
              replyToAddresses: parseStoredAddresses(message.replyToAddresses),
              snippet: message.snippet,
              bodyText: message.bodyText,
              labelIds: message.labelIds,
              hasAttachments: message.hasAttachments,
              attachmentMetadata: parseAttachmentMetadata(message.attachmentMetadata),
              sentAt: message.sentAt.toISOString(),
              receivedAt: serializeDate(message.receivedAt),
              priority: message.priority,
              itemStatus: message.itemStatus
            },
            thread: {
              id: message.thread.id,
              providerThreadId: message.thread.gmailThreadId,
              subject: message.thread.subject,
              normalizedSubject: message.thread.normalizedSubject,
              snippet: message.thread.snippet,
              lastMessageAt: serializeDate(message.thread.lastMessageAt),
              messageCount: message.thread.messageCount,
              reviewQueue: message.thread.reviewQueue,
              reviewStatus: message.thread.reviewStatus
            },
            normalizedEmail: message.normalizedEmail
              ? {
                  id: message.normalizedEmail.id,
                  sender: parseNormalizedSender(message.normalizedEmail.sender),
                  recipients: parseNormalizedParticipants(
                    message.normalizedEmail.recipients
                  ),
                  subject: message.normalizedEmail.subject,
                  normalizedSubject: message.normalizedEmail.normalizedSubject,
                  snippet: message.normalizedEmail.snippet,
                  receivedAt: serializeDate(message.normalizedEmail.receivedAt),
                  cleanTextBody: message.normalizedEmail.cleanTextBody,
                  labelHints: message.normalizedEmail.labelHints,
                  categoryHints: message.normalizedEmail.categoryHints,
                  senderDomain: message.normalizedEmail.senderDomain
                }
              : null,
            classification: serializeClassification(message.classifications[0] ?? null),
            taskCandidate: serializeTask(message.tasks[0] ?? null)
          }
        })
      );
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/review",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const query = reviewListQuerySchema.parse(request.query);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const thresholds = await getWorkspaceThresholds(app, params.workspaceId);
      const where: Prisma.EmailMessageWhereInput = {
        AND: [
          {
            workspaceId: params.workspaceId,
            inboxConnectionId: params.id
          },
          buildReviewMessageConditions({
            classificationThreshold: thresholds.classificationThreshold,
            taskThreshold: thresholds.taskThreshold
          })
        ]
      };
      const skip = (query.page - 1) * query.pageSize;

      const [totalCount, messages] = await Promise.all([
        app.services.prisma.emailMessage.count({
          where
        }),
        app.services.prisma.emailMessage.findMany({
          where,
          orderBy: [
            { receivedAt: "desc" },
            { sentAt: "desc" },
            { createdAt: "desc" }
          ],
          skip,
          take: query.pageSize,
          select: {
            id: true,
            gmailMessageId: true,
            gmailThreadId: true,
            subject: true,
            snippet: true,
            senderName: true,
            senderEmail: true,
            receivedAt: true,
            sentAt: true,
            priority: true,
            itemStatus: true,
            classifications: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                businessCategory: true,
                emailType: true,
                priority: true,
                itemStatus: true,
                summary: true,
                confidence: true,
                requiresReview: true,
                reviewQueue: true,
                reviewStatus: true,
                containsActionRequest: true,
                deadline: true,
                routingHints: true,
                extractedFields: true
              }
            },
            tasks: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                title: true,
                summary: true,
                description: true,
                assigneeGuess: true,
                dueAt: true,
                priority: true,
                status: true,
                confidence: true,
                requiresReview: true,
                reviewQueue: true,
                reviewStatus: true,
                createdAt: true,
                updatedAt: true
              }
            }
          }
        })
      ]);

      const classificationThreshold = Number(
        thresholds.classificationThreshold.toString()
      );
      const taskThreshold = Number(thresholds.taskThreshold.toString());
      const items = messages.map((message) => {
        const summary = serializeMessageSummary(message);
        const reviewReasons = buildReviewReasons({
          messageItemStatus: message.itemStatus,
          classification: summary.classification,
          task: summary.taskCandidate,
          classificationThreshold,
          taskThreshold
        });

        return reviewItemSchema.parse({
          message: summary,
          reviewReasons
        });
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.id,
        action: "inbox_connection.review_queue_viewed",
        metadata: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount
        },
        request
      });

      return reply.send(
        reviewListResponseSchema.parse({
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          thresholds: {
            classification: classificationThreshold,
            task: taskThreshold
          },
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            totalCount,
            totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize)
          },
          items
        })
      );
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/tasks",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const query = tasksListQuerySchema.parse(request.query);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const thresholds = await getWorkspaceThresholds(app, params.workspaceId);
      const where = buildTasksWhere({
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        reviewOnly: query.reviewOnly,
        lowConfidenceOnly: query.lowConfidenceOnly,
        ...(query.status ? { status: query.status } : {}),
        taskThreshold: thresholds.taskThreshold
      });
      const skip = (query.page - 1) * query.pageSize;

      const [totalCount, tasks] = await Promise.all([
        app.services.prisma.task.count({
          where
        }),
        app.services.prisma.task.findMany({
          where,
          orderBy: [
            { createdAt: "desc" },
            { updatedAt: "desc" }
          ],
          skip,
          take: query.pageSize,
          select: {
            id: true,
            title: true,
            summary: true,
            description: true,
            assigneeGuess: true,
            dueAt: true,
            priority: true,
            status: true,
            confidence: true,
            requiresReview: true,
            reviewQueue: true,
            reviewStatus: true,
            createdAt: true,
            updatedAt: true,
            sourceMessage: {
              select: {
                id: true,
                gmailMessageId: true,
                subject: true,
                snippet: true,
                senderEmail: true,
                receivedAt: true
              }
            },
            classification: {
              select: {
                id: true,
                businessCategory: true,
                emailType: true,
                priority: true,
                itemStatus: true,
                summary: true,
                confidence: true,
                requiresReview: true,
                reviewQueue: true,
                reviewStatus: true,
                containsActionRequest: true,
                deadline: true,
                routingHints: true,
                extractedFields: true
              }
            }
          }
        })
      ]);

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.id,
        action: "inbox_connection.tasks_viewed",
        metadata: {
          filters: {
            reviewOnly: query.reviewOnly,
            lowConfidenceOnly: query.lowConfidenceOnly,
            status: query.status ?? null
          },
          page: query.page,
          pageSize: query.pageSize
        },
        request
      });

      return reply.send(
        tasksListResponseSchema.parse({
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          filters: {
            reviewOnly: query.reviewOnly,
            lowConfidenceOnly: query.lowConfidenceOnly,
            status: query.status ?? null
          },
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            totalCount,
            totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize)
          },
          tasks: tasks.map((task) =>
            taskListItemSchema.parse({
              task: serializeTask(task),
              sourceMessage: task.sourceMessage
                ? {
                    id: task.sourceMessage.id,
                    providerMessageId: task.sourceMessage.gmailMessageId,
                    subject: task.sourceMessage.subject,
                    snippet: task.sourceMessage.snippet,
                    senderEmail: task.sourceMessage.senderEmail,
                    receivedAt: serializeDate(task.sourceMessage.receivedAt)
                  }
                : null,
              classification: serializeClassification(task.classification)
            })
          )
        })
      );
    }
  );
};
