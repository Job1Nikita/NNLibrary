import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { writeAuditLog } from "./audit.service";

export type UserModerationAction = "approve" | "reject" | "ban" | "unban";

export async function moderateUser(
  targetUserId: number,
  action: UserModerationAction,
  actorId?: number | null,
  ip?: string
): Promise<{ id: number; login: string; status: UserStatus }> {
  const data: Prisma.UserUpdateInput = {};

  if (action === "approve") {
    data.status = "APPROVED";
    data.approvedAt = new Date();
    data.blockedAt = null;
  } else if (action === "reject" || action === "ban") {
    data.status = "BLOCKED";
    data.blockedAt = new Date();
  } else if (action === "unban") {
    data.status = "APPROVED";
    data.blockedAt = null;
    data.approvedAt = new Date();
  }

  const user = await prisma.user.update({
    where: { id: targetUserId },
    data,
    select: { id: true, login: true, status: true }
  });

  await writeAuditLog({
    actorId,
    targetUserId,
    action: `user.${action}`,
    details: `status=${user.status}`,
    ip
  });

  return user;
}

export async function getPortalStats(): Promise<{
  visitsTotal: number;
  visitsDay: number;
  downloadsTotal: number;
  downloadsDay: number;
  usersTotal: number;
  pendingUsers: number;
  onlineUsers: Array<{ id: number; login: string; role: UserRole; status: UserStatus }>;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [visitsTotal, visitsDay, downloadsTotal, downloadsDay, usersTotal, pendingUsers, activeSessions] =
    await Promise.all([
      prisma.visitLog.count(),
      prisma.visitLog.count({ where: { visitedAt: { gte: since } } }),
      prisma.downloadLog.count(),
      prisma.downloadLog.count({ where: { downloadedAt: { gte: since } } }),
      prisma.user.count(),
      prisma.user.count({ where: { status: "PENDING" } }),
      prisma.session.findMany({
        where: { expiresAt: { gt: new Date() } },
        select: { data: true }
      })
    ]);

  const onlineUserIds = new Set<number>();
  for (const session of activeSessions) {
    try {
      const data = JSON.parse(session.data) as { userId?: unknown };
      const value = data.userId;
      const userId = typeof value === "number" ? value : Number(value);
      if (Number.isInteger(userId) && userId > 0) {
        onlineUserIds.add(userId);
      }
    } catch {
      // Ignore malformed session payloads.
    }
  }

  const onlineUsers =
    onlineUserIds.size === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: Array.from(onlineUserIds) } },
          select: { id: true, login: true, role: true, status: true },
          orderBy: { login: "asc" }
        });

  return { visitsTotal, visitsDay, downloadsTotal, downloadsDay, usersTotal, pendingUsers, onlineUsers };
}

export async function findUserByIdentifier(
  input: string
): Promise<{ id: number; login: string; role: UserRole; status: UserStatus } | null> {
  const normalized = input.trim();
  if (!normalized) {
    return null;
  }

  const asNumber = Number(normalized);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    return prisma.user.findUnique({
      where: { id: asNumber },
      select: { id: true, login: true, role: true, status: true }
    });
  }

  return prisma.user.findUnique({
    where: { login: normalized.toLowerCase() },
    select: { id: true, login: true, role: true, status: true }
  });
}

export async function deleteUserAccount(
  targetUserId: number,
  actorId?: number | null,
  ip?: string
): Promise<{ id: number; login: string }> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, login: true, role: true }
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (user.role === "ADMIN") {
    throw new Error("CANNOT_DELETE_ADMIN");
  }

  await prisma.user.delete({ where: { id: targetUserId } });

  await writeAuditLog({
    actorId,
    action: "user.delete",
    details: `deleted_user_id=${user.id};deleted_login=${user.login}`,
    ip
  });

  return { id: user.id, login: user.login };
}
