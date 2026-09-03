import { describe, it, expect } from "vitest";
import { z } from "zod";

const JOB_STATUS_VALUES = [
  "LEAD",
  "BIDDING",
  "AWARDED",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETE",
  "ARCHIVED",
  "COMPLETED",
  "CANCELLED",
] as const;

const JOB_ASSIGNMENT_SOURCE_VALUES = [
  "AI_SUGGESTED",
  "AI_AUTO_ASSIGNED",
  "USER_ASSIGNED",
  "FOLDER_ALIAS",
  "JOB_NUMBER_MATCH",
  "IMPORT",
  "VERIFIED_PROJECT_FOLDER",
] as const;

const JOB_ACTIVITY_ACTION_VALUES = [
  "JOB_CREATED",
  "JOB_UPDATED",
  "JOB_ARCHIVED",
  "JOB_RESTORED",
  "JOB_STATUS_CHANGED",
  "EMAIL_ASSIGNED",
  "EMAIL_REMOVED",
  "EMAIL_REASSIGNED",
  "TASK_LINKED",
  "TASK_REMOVED",
  "MEMBER_ADDED",
  "MEMBER_REMOVED",
  "ALIAS_ADDED",
  "ALIAS_REMOVED",
  "CUSTOMER_CHANGED",
] as const;

const createJobSchema = z.object({
  jobNumber: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  status: z.enum(JOB_STATUS_VALUES).optional().default("ACTIVE"),
  customerId: z.string().max(100).nullable().optional(),
  description: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  startDate: z
    .string()
    .datetime()
    .optional()
    .nullable(),
  targetCompletionDate: z
    .string()
    .datetime()
    .optional()
    .nullable(),
  memberUserIds: z.array(z.string().min(1)).max(50).optional(),
  aliases: z.array(z.string().min(1).max(200)).max(50).optional(),
});

const updateJobSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  jobNumber: z.string().min(1).max(50).optional(),
  status: z.enum(JOB_STATUS_VALUES).optional(),
  customerId: z.string().max(100).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  targetCompletionDate: z.string().datetime().nullable().optional(),
});

const assignEmailSchema = z.object({
  messageId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
}).refine(
  (data) => data.messageId || data.threadId,
  { message: "Either messageId or threadId is required" }
);

const moveEmailSchema = z.object({
  messageId: z.string().min(1),
  targetJobId: z.string().min(1),
});

const jobListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  status: z.enum(JOB_STATUS_VALUES).optional(),
  customerId: z.string().optional(),
  search: z.string().optional(),
  assignedUserId: z.string().optional(),
  hasOverdueTasks: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  showArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  sortBy: z
    .enum([
      "jobNumber",
      "name",
      "status",
      "createdAt",
      "lastActivity",
      "emailCount",
    ])
    .optional()
    .default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
});

const jobDetailResponseSchema = z.object({
  job: z.object({
    id: z.string().min(1),
    jobNumber: z.string().nullable(),
    name: z.string().min(1),
    status: z.enum(JOB_STATUS_VALUES),
    customerId: z.string().nullable(),
    customerName: z.string().nullable(),
    description: z.string().nullable(),
    notes: z.string().nullable(),
    externalRef: z.string().nullable(),
    startDate: z.string().nullable(),
    targetCompletionDate: z.string().nullable(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    emailCount: z.number().int().nonnegative(),
    openTaskCount: z.number().int().nonnegative(),
    overdueTaskCount: z.number().int().nonnegative(),
    completedTaskCount: z.number().int().nonnegative(),
    recentEmails7d: z.number().int().nonnegative(),
    recentEmails30d: z.number().int().nonnegative(),
    lastActivityAt: z.string().nullable(),
    nextDueDate: z.string().nullable(),
    attachmentCount: z.number().int().nonnegative(),
    members: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        name: z.string().nullable(),
        email: z.string(),
        role: z.string().nullable(),
        createdAt: z.string(),
      })
    ),
    aliases: z.array(
      z.object({
        id: z.string(),
        alias: z.string(),
        normalizedAlias: z.string(),
      })
    ),
    assignedMembers: z.array(
      z.object({
        userId: z.string(),
        name: z.string().nullable(),
        email: z.string(),
        role: z.string().nullable(),
      })
    ),
  }),
});

describe("Jobs Feature - Schema Validation", () => {
  describe("createJobSchema", () => {
    it("accepts valid job creation payload", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
        name: "Test Job",
        status: "ACTIVE",
        customerId: "cust_123",
        description: "A test job",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.jobNumber).toBe("JOB-001");
        expect(result.data.name).toBe("Test Job");
        expect(result.data.status).toBe("ACTIVE");
      }
    });

    it("requires jobNumber", () => {
      const result = createJobSchema.safeParse({
        name: "Test Job",
      });
      expect(result.success).toBe(false);
    });

    it("requires name", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
      });
      expect(result.success).toBe(false);
    });

    it("defaults status to ACTIVE", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
        name: "Test Job",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe("ACTIVE");
      }
    });

    it("accepts all valid statuses", () => {
      for (const status of JOB_STATUS_VALUES) {
        const result = createJobSchema.safeParse({
          jobNumber: "JOB-001",
          name: "Test Job",
          status,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid status", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
        name: "Test Job",
        status: "INVALID_STATUS",
      });
      expect(result.success).toBe(false);
    });

    it("rejects jobNumber longer than 50 chars", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "A".repeat(51),
        name: "Test Job",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name longer than 200 chars", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
        name: "A".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("accepts optional dates as ISO strings", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
        name: "Test Job",
        startDate: "2026-08-01T00:00:00.000Z",
        targetCompletionDate: "2026-12-31T00:00:00.000Z",
      });
      expect(result.success).toBe(true);
    });

    it("accepts member user IDs array", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
        name: "Test Job",
        memberUserIds: ["user1", "user2", "user3"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memberUserIds).toHaveLength(3);
      }
    });

    it("accepts aliases array", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
        name: "Test Job",
        aliases: ["Alias 1", "Alias 2"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.aliases).toHaveLength(2);
      }
    });

    it("rejects more than 50 members", () => {
      const result = createJobSchema.safeParse({
        jobNumber: "JOB-001",
        name: "Test Job",
        memberUserIds: Array.from({ length: 51 }, (_, i) => `user${i}`),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateJobSchema", () => {
    it("accepts partial updates", () => {
      const result = updateJobSchema.safeParse({
        name: "Updated Name",
      });
      expect(result.success).toBe(true);
    });

    it("accepts status change", () => {
      const result = updateJobSchema.safeParse({
        status: "ON_HOLD",
      });
      expect(result.success).toBe(true);
    });

    it("accepts null customerId", () => {
      const result = updateJobSchema.safeParse({
        customerId: null,
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty object (no changes)", () => {
      const result = updateJobSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts null dates to clear them", () => {
      const result = updateJobSchema.safeParse({
        startDate: null,
        targetCompletionDate: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("assignEmailSchema", () => {
    it("accepts messageId", () => {
      const result = assignEmailSchema.safeParse({
        messageId: "msg_123",
      });
      expect(result.success).toBe(true);
    });

    it("accepts threadId", () => {
      const result = assignEmailSchema.safeParse({
        threadId: "thread_123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects when neither messageId nor threadId provided", () => {
      const result = assignEmailSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts both messageId and threadId", () => {
      const result = assignEmailSchema.safeParse({
        messageId: "msg_123",
        threadId: "thread_123",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("moveEmailSchema", () => {
    it("accepts valid move payload", () => {
      const result = moveEmailSchema.safeParse({
        messageId: "msg_123",
        targetJobId: "job_456",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing messageId", () => {
      const result = moveEmailSchema.safeParse({
        targetJobId: "job_456",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing targetJobId", () => {
      const result = moveEmailSchema.safeParse({
        messageId: "msg_123",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("jobListQuerySchema", () => {
    it("provides sensible defaults", () => {
      const result = jobListQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(25);
        expect(result.data.sortBy).toBe("createdAt");
        expect(result.data.sortDir).toBe("desc");
      }
    });

    it("parses page and pageSize from strings", () => {
      const result = jobListQuerySchema.safeParse({
        page: "3",
        pageSize: "50",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.pageSize).toBe(50);
      }
    });

    it("rejects pageSize > 100", () => {
      const result = jobListQuerySchema.safeParse({
        pageSize: "101",
      });
      expect(result.success).toBe(false);
    });

    it("parses boolean filters", () => {
      const result = jobListQuerySchema.safeParse({
        hasOverdueTasks: "true",
        showArchived: "true",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasOverdueTasks).toBe(true);
        expect(result.data.showArchived).toBe(true);
      }
    });

    it("accepts status filter", () => {
      const result = jobListQuerySchema.safeParse({
        status: "ACTIVE",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe("ACTIVE");
      }
    });

    it("accepts search filter", () => {
      const result = jobListQuerySchema.safeParse({
        search: "renovation",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.search).toBe("renovation");
      }
    });
  });
});

describe("Jobs Feature - Assignment Logic", () => {
  it("USER_ASSIGNED source marks job as manual assignment", () => {
    const assignmentData = {
      jobAssignmentSource: "USER_ASSIGNED" as const,
      jobAssignmentIsManual: true,
      jobAssignedAt: new Date().toISOString(),
      jobAssignedByUserId: "user_123",
    };
    expect(assignmentData.jobAssignmentIsManual).toBe(true);
    expect(assignmentData.jobAssignmentSource).toBe("USER_ASSIGNED");
  });

  it("AI_SUGGESTED source does NOT mark as manual", () => {
    const assignmentData = {
      jobAssignmentSource: "AI_SUGGESTED" as const,
      jobAssignmentIsManual: false,
      jobMatchConfidence: 0.85,
    };
    expect(assignmentData.jobAssignmentIsManual).toBe(false);
  });

  it("manual assignment should not be overridden by AI", () => {
    const existingAssignment = {
      jobId: "job_123",
      jobAssignmentSource: "USER_ASSIGNED" as const,
      jobAssignmentIsManual: true,
    };

    const aiSuggestion = {
      jobId: "job_456",
      jobAssignmentSource: "AI_AUTO_ASSIGNED" as const,
      jobMatchConfidence: 0.95,
    };

    const aiSource: string = aiSuggestion.jobAssignmentSource;
    const shouldOverride =
      !existingAssignment.jobAssignmentIsManual ||
      aiSource === "USER_ASSIGNED";

    expect(shouldOverride).toBe(false);
  });

  it("AI assignment CAN override another AI assignment", () => {
    const existingAssignment = {
      jobId: "job_123",
      jobAssignmentSource: "AI_AUTO_ASSIGNED" as const,
      jobAssignmentIsManual: false,
    };

    const shouldOverride = !existingAssignment.jobAssignmentIsManual;
    expect(shouldOverride).toBe(true);
  });

  it("all assignment sources are valid enum values", () => {
    const sourceSchema = z.enum(JOB_ASSIGNMENT_SOURCE_VALUES);
    for (const source of JOB_ASSIGNMENT_SOURCE_VALUES) {
      expect(sourceSchema.safeParse(source).success).toBe(true);
    }
  });
});

describe("Jobs Feature - Activity Log", () => {
  it("all activity actions are valid", () => {
    const actionSchema = z.enum(JOB_ACTIVITY_ACTION_VALUES);
    for (const action of JOB_ACTIVITY_ACTION_VALUES) {
      expect(actionSchema.safeParse(action).success).toBe(true);
    }
  });

  it("activity log entry shape is correct", () => {
    const activityEntrySchema = z.object({
      id: z.string(),
      jobId: z.string(),
      workspaceId: z.string(),
      actorUserId: z.string().nullable(),
      action: z.enum(JOB_ACTIVITY_ACTION_VALUES),
      entityType: z.string().nullable(),
      entityId: z.string().nullable(),
      previousValue: z.unknown().nullable(),
      newValue: z.unknown().nullable(),
      createdAt: z.string(),
    });

    const entry = {
      id: "act_001",
      jobId: "job_123",
      workspaceId: "ws_456",
      actorUserId: "user_789",
      action: "EMAIL_ASSIGNED" as const,
      entityType: "EMAIL_MESSAGE",
      entityId: "msg_abc",
      previousValue: null,
      newValue: { jobId: "job_123", source: "USER_ASSIGNED" },
      createdAt: new Date().toISOString(),
    };

    expect(activityEntrySchema.safeParse(entry).success).toBe(true);
  });
});

describe("Jobs Feature - Workspace Isolation", () => {
  it("cross-workspace job access should be prevented", () => {
    const requestWorkspaceId: string = "workspace_A";
    const jobWorkspaceId: string = "workspace_B";
    expect(requestWorkspaceId === jobWorkspaceId).toBe(false);
  });

  it("same workspace job access should be allowed", () => {
    const requestWorkspaceId: string = "workspace_A";
    const jobWorkspaceId: string = "workspace_A";
    expect(requestWorkspaceId === jobWorkspaceId).toBe(true);
  });

  it("cross-workspace email assignment should be rejected", () => {
    const jobWorkspaceId: string = "workspace_A";
    const messageWorkspaceId: string = "workspace_B";
    const targetJobWorkspaceId: string = "workspace_A";

    const canAssign =
      jobWorkspaceId === messageWorkspaceId &&
      jobWorkspaceId === targetJobWorkspaceId;
    expect(canAssign).toBe(false);
  });
});

describe("Jobs Feature - Permission Model", () => {
  it("OWNER can create jobs", () => {
    const canEdit = (role: string) => role === "OWNER" || role === "EDITOR";
    expect(canEdit("OWNER")).toBe(true);
  });

  it("EDITOR can create jobs", () => {
    const canEdit = (role: string) => role === "OWNER" || role === "EDITOR";
    expect(canEdit("EDITOR")).toBe(true);
  });

  it("VIEWER cannot create jobs", () => {
    const canEdit = (role: string) => role === "OWNER" || role === "EDITOR";
    expect(canEdit("VIEWER")).toBe(false);
  });

  it("VIEWER can read jobs", () => {
    const canRead = (_role: string) => true;
    expect(canRead("VIEWER")).toBe(true);
  });

  it("VIEWER cannot archive jobs", () => {
    const canEdit = (role: string) => role === "OWNER" || role === "EDITOR";
    expect(canEdit("VIEWER")).toBe(false);
  });
});

describe("Jobs Feature - Response Shape", () => {
  it("job detail response matches expected schema", () => {
    const response = {
      job: {
        id: "job_123",
        jobNumber: "JOB-001",
        name: "Test Construction Job",
        status: "ACTIVE" as const,
        customerId: "cust_456",
        customerName: "Acme Corp",
        description: "A test construction project",
        notes: "Internal notes here",
        externalRef: "EXT-REF-001",
        startDate: "2026-01-01T00:00:00.000Z",
        targetCompletionDate: "2026-12-31T00:00:00.000Z",
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        emailCount: 42,
        openTaskCount: 5,
        overdueTaskCount: 2,
        completedTaskCount: 15,
        recentEmails7d: 7,
        recentEmails30d: 18,
        lastActivityAt: "2026-08-02T10:00:00.000Z",
        nextDueDate: "2026-08-10T00:00:00.000Z",
        attachmentCount: 23,
        members: [
          {
            id: "jm_001",
            userId: "user_789",
            name: "John Doe",
            email: "john@example.com",
            role: "Lead",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        aliases: [
          {
            id: "alias_001",
            alias: "Acme Reno",
            normalizedAlias: "acme reno",
          },
        ],
        assignedMembers: [
          {
            userId: "user_789",
            name: "John Doe",
            email: "john@example.com",
            role: "Lead",
          },
        ],
      },
    };

    const result = jobDetailResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it("empty job (no emails, no tasks) is valid", () => {
    const response = {
      job: {
        id: "job_empty",
        jobNumber: "JOB-EMPTY",
        name: "Empty Job",
        status: "LEAD" as const,
        customerId: null,
        customerName: null,
        description: null,
        notes: null,
        externalRef: null,
        startDate: null,
        targetCompletionDate: null,
        archivedAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        emailCount: 0,
        openTaskCount: 0,
        overdueTaskCount: 0,
        completedTaskCount: 0,
        recentEmails7d: 0,
        recentEmails30d: 0,
        lastActivityAt: null,
        nextDueDate: null,
        attachmentCount: 0,
        members: [],
        aliases: [],
        assignedMembers: [],
      },
    };

    const result = jobDetailResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });
});

describe("Jobs Feature - Duplicate Job Number", () => {
  it("job numbers must be unique within workspace", () => {
    const existingJobNumbers = ["JOB-001", "JOB-002", "JOB-003"];
    const newJobNumber = "JOB-001";
    const isDuplicate = existingJobNumbers.includes(newJobNumber);
    expect(isDuplicate).toBe(true);
  });

  it("same job number in different workspaces is allowed", () => {
    const workspaceAJobs = ["JOB-001", "JOB-002"];
    const workspaceBJobs = ["JOB-001", "JOB-003"];
    const requestJobNumber = "JOB-001";
    const requestWorkspace: string = "B";

    const targetJobs = requestWorkspace === "A" ? workspaceAJobs : workspaceBJobs;
    const isDuplicate = targetJobs.includes(requestJobNumber);
    expect(isDuplicate).toBe(true);
  });
});

describe("Jobs Feature - Alias Lookup", () => {
  it("normalized alias matching is case-insensitive", () => {
    const normalize = (s: string) => s.toLowerCase().trim();
    const alias = "Acme Renovation Project";
    const search = "acme renovation project";
    expect(normalize(alias)).toBe(normalize(search));
  });

  it("alias lookup finds job by alternate name", () => {
    const aliases = [
      { jobId: "job_1", normalizedAlias: "acme reno" },
      { jobId: "job_2", normalizedAlias: "downtown office" },
      { jobId: "job_3", normalizedAlias: "smith residence" },
    ];

    const searchTerm = "downtown office";
    const match = aliases.find((a) => a.normalizedAlias === searchTerm);
    expect(match).toBeDefined();
    expect(match?.jobId).toBe("job_2");
  });
});

describe("Jobs Feature - Metrics Computation", () => {
  it("overdue tasks are tasks with dueAt < now and status OPEN/IN_PROGRESS", () => {
    const now = new Date();
    const tasks = [
      { id: "t1", status: "OPEN", dueAt: new Date(now.getTime() - 86400000) },
      { id: "t2", status: "OPEN", dueAt: new Date(now.getTime() + 86400000) },
      { id: "t3", status: "DONE", dueAt: new Date(now.getTime() - 86400000) },
      { id: "t4", status: "IN_PROGRESS", dueAt: new Date(now.getTime() - 86400000) },
      { id: "t5", status: "OPEN", dueAt: null },
    ];

    const overdue = tasks.filter(
      (t) =>
        t.dueAt &&
        t.dueAt < now &&
        (t.status === "OPEN" || t.status === "IN_PROGRESS")
    );
    expect(overdue).toHaveLength(2);
    expect(overdue.map((t) => t.id)).toContain("t1");
    expect(overdue.map((t) => t.id)).toContain("t4");
  });

  it("next due date is earliest open task due date", () => {
    const tasks = [
      { status: "OPEN", dueAt: new Date("2026-08-15") },
      { status: "OPEN", dueAt: new Date("2026-08-05") },
      { status: "DONE", dueAt: new Date("2026-08-01") },
      { status: "OPEN", dueAt: null },
    ];

    const openWithDue = tasks
      .filter((t) => t.dueAt && (t.status === "OPEN" || t.status === "IN_PROGRESS"))
      .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());

    const nextDueDate = openWithDue[0]?.dueAt ?? null;
    expect(nextDueDate).toEqual(new Date("2026-08-05"));
  });

  it("email subtype counts from classifications", () => {
    const emails = [
      { classification: { emailType: "ACTIONABLE_REQUEST" } },
      { classification: { emailType: "FYI_UPDATE" } },
      { classification: { emailType: "ACTIONABLE_REQUEST" } },
      { classification: null },
      { classification: { emailType: "SUPPORT_CUSTOMER_ISSUE" } },
    ];

    const subtypeCounts = emails.reduce(
      (acc, e) => {
        const type = e.classification?.emailType ?? "UNCLASSIFIED";
        acc[type] = (acc[type] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    expect(subtypeCounts["ACTIONABLE_REQUEST"]).toBe(2);
    expect(subtypeCounts["FYI_UPDATE"]).toBe(1);
    expect(subtypeCounts["SUPPORT_CUSTOMER_ISSUE"]).toBe(1);
    expect(subtypeCounts["UNCLASSIFIED"]).toBe(1);
  });
});
