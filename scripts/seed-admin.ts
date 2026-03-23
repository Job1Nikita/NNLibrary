import { env } from "../src/config/env";
import { prisma, ensureSqliteWal } from "../src/db/prisma";
import { hashPassword } from "../src/lib/password";

async function main(): Promise<void> {
  await ensureSqliteWal();

  const login = env.ADMIN_LOGIN.toLowerCase();
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);

  const admin = await prisma.user.upsert({
    where: { login },
    update: {
      passwordHash,
      role: "ADMIN",
      status: "APPROVED",
      approvedAt: new Date(),
      blockedAt: null
    },
    create: {
      login,
      passwordHash,
      role: "ADMIN",
      status: "APPROVED",
      approvedAt: new Date()
    }
  });

  // eslint-disable-next-line no-console
  console.log(`Admin user ready: login=${admin.login}, id=${admin.id}`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
