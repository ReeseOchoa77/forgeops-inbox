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
    /**
     * Platform Admin delegated onboarding: OAuth identity may differ from
     * targetMailboxEmail; Graph must verify access to the target.
     */
    delegatedMailboxAccess: z.boolean().optional().default(false),
    /** Locked target mailbox for delegated flows (must match connection.email). */
    targetMailboxEmail: z.string().email().optional(),
    createdAt: z.string().datetime()
  })
]);

export type GoogleOAuthState = z.infer<typeof googleOAuthStateSchema>;
