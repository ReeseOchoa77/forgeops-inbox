import type { PrismaClient, WorkspaceRole, PlatformRole } from "@prisma/client";
import type { FastifyRequest, FastifyReply } from "fastify";
import { getSessionFromRequest } from "../../interfaces/http/authentication.js";

export interface AuthenticatedUser {
  userId: string;
  email: string;
  platformRole: PlatformRole;
  isPlatformAdmin: boolean;
}

export interface WorkspaceMember extends AuthenticatedUser {
  membershipId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
}

export async function requireAuthenticated(
  prisma: PrismaClient,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthenticatedUser | null> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    reply.code(401).send({ message: "Authentication required" });
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, platformRole: true, isPlatformAdmin: true }
  });

  if (!user) {
    reply.code(401).send({ message: "User not found" });
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    platformRole: user.platformRole,
    isPlatformAdmin: user.platformRole === "PLATFORM_ADMIN"
  };
}

export async function requirePlatformAdmin(
  prisma: PrismaClient,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthenticatedUser | null> {
  const user = await requireAuthenticated(prisma, request, reply);
  if (!user) return null;

  if (user.platformRole !== "PLATFORM_ADMIN") {
    reply.code(403).send({ message: "Platform admin access required" });
    return null;
  }

  return user;
}

export async function requireWorkspaceMember(
  prisma: PrismaClient,
  request: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
  minimumRole?: WorkspaceRole
): Promise<WorkspaceMember | null> {
  const user = await requireAuthenticated(prisma, request, reply);
  if (!user) return null;

  const membership = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.userId } },
    select: { id: true, workspaceRole: true, workspaceId: true }
  });

  if (!membership) {
    reply.code(403).send({ message: "Workspace access denied" });
    return null;
  }

  if (minimumRole) {
    const hierarchy: Record<WorkspaceRole, number> = {
      OWNER: 3,
      EDITOR: 2,
      VIEWER: 1
    };

    if (hierarchy[membership.workspaceRole] < hierarchy[minimumRole]) {
      reply.code(403).send({ message: `Requires ${minimumRole} role or higher` });
      return null;
    }
  }

  return {
    ...user,
    membershipId: membership.id,
    workspaceId: membership.workspaceId,
    workspaceRole: membership.workspaceRole
  };
}

export function canEdit(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "EDITOR";
}

export function canManageMembers(role: WorkspaceRole): boolean {
  return role === "OWNER";
}
