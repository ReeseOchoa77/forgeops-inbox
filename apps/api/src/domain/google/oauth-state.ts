import { z } from "zod";

const inboxProviderKindSchema = z.enum(["gmail", "outlook"]);

export const googleOAuthStateSchema = z.discriminatedUnion("flow", [
  z.object({
    flow: z.literal("app-auth"),
    createdAt: z.string().datetime()
  }),
  z.object({
    flow: z.literal("inbox-connect"),
    provider: inboxProviderKindSchema.optional().default("gmail"),
    workspaceId: z.string().min(1),
    userId: z.string().min(1),
    connectionId: z.string().min(1).optional(),
    reconnect: z.boolean(),
    /** Targeted upgrade of an existing tokenless (e.g. n8n) Outlook connection. */
    authorizeExisting: z.boolean().optional().default(false),
    createdAt: z.string().datetime()
  })
]);

export type GoogleOAuthState = z.infer<typeof googleOAuthStateSchema>;
