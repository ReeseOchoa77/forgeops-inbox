import { z } from "zod";
import {
  normalizeTaskDueAt,
  type StoredPriority,
} from "@forgeops/shared";

/**
 * Pre-Prisma validation for native Task upsert payloads.
 * Invalid optional values are rejected here so Prisma is never the first validator.
 */

const validDate = z.date().refine((d) => !Number.isNaN(d.getTime()), {
  message: "Date must be a valid DateTime",
});

export const nativeTaskPersistPayloadSchema = z.object({
  sourceTaskKey: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(2000),
  summary: z.string().max(20_000).nullable(),
  description: z.string().max(20_000).nullable(),
  assigneeGuess: z.string().trim().min(1).max(500).nullable(),
  dueAt: validDate.nullable(),
  sourceDate: validDate,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  status: z.literal("OPEN"),
  confidence: z.number().finite().min(0).max(1),
  requiresReview: z.boolean(),
  reviewQueue: z.enum(["TRIAGE", "EXTRACTION", "ROUTING", "QA"]).nullable(),
  reviewStatus: z.enum([
    "NOT_REQUIRED",
    "PENDING",
    "IN_REVIEW",
    "APPROVED",
    "REJECTED",
  ]),
  reviewedByUserId: z.null(),
  reviewedAt: z.null(),
  completedAt: z.null(),
});

export type NativeTaskPersistPayload = z.infer<
  typeof nativeTaskPersistPayloadSchema
>;

export type BuildNativeTaskPersistInput = {
  sourceTaskKey: string;
  title: string;
  description: string | null | undefined;
  recommendedOwner: string | null | undefined;
  dueDate: unknown;
  sourceDate: Date;
  priority: StoredPriority;
  confidence: number;
  requiresReview: boolean;
  emailMessageId?: string;
};

/**
 * Normalize model task → validated persist payload.
 * Throws ZodError when required fields are unusable (caller skips that task).
 */
export function buildNativeTaskPersistPayload(
  input: BuildNativeTaskPersistInput
): NativeTaskPersistPayload {
  const dueAt = normalizeTaskDueAt(input.dueDate, {
    ...(input.emailMessageId ? { emailMessageId: input.emailMessageId } : {}),
  });

  // recommendedOwner is a display-name guess (free text), not an email FK.
  const ownerRaw =
    typeof input.recommendedOwner === "string"
      ? input.recommendedOwner.trim()
      : "";
  const assigneeGuess = ownerRaw ? ownerRaw.slice(0, 500) : null;

  const description =
    typeof input.description === "string" && input.description.trim()
      ? input.description.trim().slice(0, 20_000)
      : null;

  return nativeTaskPersistPayloadSchema.parse({
    sourceTaskKey: input.sourceTaskKey,
    title: input.title,
    summary: description,
    description,
    assigneeGuess,
    dueAt,
    sourceDate: input.sourceDate,
    priority: input.priority,
    status: "OPEN",
    confidence: input.confidence,
    requiresReview: input.requiresReview,
    reviewQueue: input.requiresReview ? "EXTRACTION" : null,
    reviewStatus: input.requiresReview ? "PENDING" : "NOT_REQUIRED",
    reviewedByUserId: null,
    reviewedAt: null,
    completedAt: null,
  });
}
