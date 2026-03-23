import { prisma } from "../db/prisma";

export async function getActiveNotice(): Promise<{ id: number; text: string } | null> {
  const notice = await prisma.siteNotice.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, text: true }
  });

  return notice;
}

export async function publishNotice(text: string, createdById?: number | null): Promise<void> {
  await prisma.$transaction([
    prisma.siteNotice.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.siteNotice.create({
      data: {
        text,
        isActive: true,
        createdById: createdById ?? null
      }
    })
  ]);
}

export async function clearNotices(): Promise<void> {
  await prisma.siteNotice.updateMany({ where: { isActive: true }, data: { isActive: false } });
}
