import fs from "fs/promises";
import path from "path";
import { env } from "../src/config/env";
import { prisma, ensureSqliteWal } from "../src/db/prisma";
import { computeFileHashesAndStats } from "../src/lib/hash";
import { normalizeRelativeStoragePath, resolveStorageAbsolutePath } from "../src/lib/storage";

type ScanArgs = {
  directoryId?: number;
};

function parseArgs(): ScanArgs {
  const args = process.argv.slice(2);
  const result: ScanArgs = {};

  const idx = args.indexOf("--dir");
  if (idx >= 0 && args[idx + 1]) {
    const value = Number(args[idx + 1]);
    if (Number.isInteger(value) && value > 0) {
      result.directoryId = value;
    }
  }

  return result;
}

async function walk(root: string, onFile: (relativePath: string) => Promise<void>): Promise<void> {
  const stack: string[] = [""];

  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = rel ? path.join(root, rel) : root;
    const entries = await fs.readdir(abs, { withFileTypes: true });

    for (const entry of entries) {
      const nextRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(nextRel);
      } else if (entry.isFile()) {
        await onFile(nextRel);
      }
    }
  }
}

async function main(): Promise<void> {
  await ensureSqliteWal();

  const args = parseArgs();
  if (args.directoryId) {
    const dir = await prisma.directory.findUnique({ where: { id: args.directoryId }, select: { id: true } });
    if (!dir) {
      throw new Error(`Directory id=${args.directoryId} not found`);
    }
  }

  let processed = 0;
  await walk(env.STORAGE_ROOT, async (diskRelativePath) => {
    const normalized = normalizeRelativeStoragePath(diskRelativePath);
    const absolute = resolveStorageAbsolutePath(env.STORAGE_ROOT, normalized);
    const { sha256, md5, size, lastModified } = await computeFileHashesAndStats(absolute);

    const name = path.basename(normalized);
    const extension = path.extname(name).replace(/^\./, "").toLowerCase();

    await prisma.file.upsert({
      where: { relativePath: normalized },
      update: {
        directoryId: args.directoryId ?? null,
        name,
        extension,
        sha256,
        md5,
        size,
        lastModified,
        uploadAt: new Date()
      },
      create: {
        directoryId: args.directoryId ?? null,
        relativePath: normalized,
        name,
        extension,
        sha256,
        md5,
        size,
        lastModified,
        uploadAt: new Date()
      }
    });

    processed += 1;
    if (processed % 25 === 0) {
      // eslint-disable-next-line no-console
      console.log(`Processed ${processed} files...`);
    }
  });

  // eslint-disable-next-line no-console
  console.log(`Scan completed. Processed files: ${processed}`);
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
