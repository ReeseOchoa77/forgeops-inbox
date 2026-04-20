import { z } from "zod";

export const authSessionSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  createdAt: z.string().datetime()
});

export type AuthSession = z.infer<typeof authSessionSchema>;

