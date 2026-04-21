import { z } from "zod";

export const normalizedEmailParticipantSchema = z.object({
  name: z.string().min(1).nullable(),
  email: z.string().email(),
  role: z.enum(["FROM", "TO", "CC", "BCC", "REPLY_TO"])
});

export const normalizedEmailSchema = z.object({
  sender: normalizedEmailParticipantSchema,
  recipients: z.array(normalizedEmailParticipantSchema),
  subject: z.string().min(1).nullable(),
  normalizedSubject: z.string().min(1).nullable(),
  snippet: z.string().min(1).nullable(),
  receivedAt: z.date().nullable(),
  cleanTextBody: z.string().min(1).nullable(),
  labelHints: z.array(z.string().min(1)),
  categoryHints: z.array(z.string().min(1)),
  senderDomain: z.string().min(1).nullable()
});

export const classifiedEmailSchema = z.object({
  businessCategory: z.enum(["BUSINESS", "NON_BUSINESS"]),
  emailType: z.enum([
    "ACTIONABLE_REQUEST",
    "FYI_UPDATE",
    "SALES_MARKETING",
    "SUPPORT_CUSTOMER_ISSUE",
    "RECRUITING_HIRING",
    "INTERNAL_COORDINATION",
    "NEEDS_REVIEW"
  ]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  itemStatus: z.enum(["NEW", "NEEDS_REVIEW"]),
  summary: z.string().min(1),
  containsActionRequest: z.boolean(),
  confidence: z.number().min(0).max(1),
  requiresReview: z.boolean(),
  routingHints: z.array(z.string().min(1)),
  categoryHints: z.array(z.string().min(1))
});

export const extractedTaskCandidateSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(1),
  assigneeGuess: z.string().min(1).nullable(),
  dueAt: z.date().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  confidence: z.number().min(0).max(1),
  requiresReview: z.boolean()
});

export type NormalizedEmail = z.infer<typeof normalizedEmailSchema>;
export type NormalizedEmailParticipant = z.infer<
  typeof normalizedEmailParticipantSchema
>;
export type ClassifiedEmail = z.infer<typeof classifiedEmailSchema>;
export type ExtractedTaskCandidate = z.infer<
  typeof extractedTaskCandidateSchema
>;
