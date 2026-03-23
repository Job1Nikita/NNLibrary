import { prisma } from "../db/prisma";

type AuditArgs = {
  actorId?: number | null;
  targetUserId?: number | null;
  action: string;
  details?: string;
  ip?: string;
};

export async function writeAuditLog(args: AuditArgs): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: args.actorId ?? null,
      targetUserId: args.targetUserId ?? null,
      action: args.action,
      details: args.details,
      ip: args.ip
    }
  });
}
