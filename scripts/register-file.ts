import path from "path";
import fs from "fs/promises";
import { env } from "../src/config/env";
import { prisma, ensureSqliteWal } from "../src/db/prisma";
import { computeFileHashesAndStats } from "../src/lib/hash";
import { normalizeRelativeStoragePath, resolveStorageAbsolutePath } from "../src/lib/storage";

type Args = {
  relativePath?: string;
  directoryId?: number;
  visibleName?: string;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {};

  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    const value = args[i + 1];

    if (!key.startsWith("--") || !value || value.startsWith("--")) {
      continue;
    }

    if (key === "--path") {
      result.relativePath = value;
      i += 1;
    }

    if (key === "--dir") {
      result.directoryId = Number(value);
      i += 1;
    }

    if (key === "--name") {
      result.visibleName = value;
      i += 1;
    }
  }

  return result;
}

async function main(): Promise<void> {
  await ensureSqliteWal();

  const args = parseArgs();
  if (!args.relativePath) {
    throw new Error("Usage: npm run register:file -- --path <relative/path> [--dir <directoryId>] [--name <visibleName>]");
  }

  if (args.directoryId !== undefined && (!Number.isInteger(args.directoryId) || args.directoryId <= 0)) {
    throw new Error("--dir must be positive integer");
  }

  if (args.directoryId) {
    const dir = await prisma.directory.findUnique({ where: { id: args.directoryId }, select: { id: true } });
    if (!dir) {
      throw new Error(`Directory id=${args.directoryId} not found`);
    }
  }

  const relativePath = normalizeRelativeStoragePath(args.relativePath);
  const absolutePath = resolveStorageAbsolutePath(env.STORAGE_ROOT, relativePath);

  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error("Provided path is not a file");
  }

  const { sha256, md5, size, lastModified } = await computeFileHashesAndStats(absolutePath);
  const visibleName = args.visibleName?.trim() || path.basename(relativePath);
  const extension = path.extname(visibleName).replace(/^\./, "").toLowerCase();

  const file = await prisma.file.upsert({
    where: { relativePath },
    update: {
      directoryId: args.directoryId ?? null,
      name: visibleName,
      extension,
      sha256,
      md5,
      size,
      lastModified,
      uploadAt: new Date()
    },
    create: {
      directoryId: args.directoryId ?? null,
      relativePath,
      name: visibleName,
      extension,
      sha256,
      md5,
      size,
      lastModified,
      uploadAt: new Date()
    }
  });

  // eslint-disable-next-line no-console
  console.log(`File registered: id=${file.id}, path=${relativePath}`);
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
