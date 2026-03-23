import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export type Breadcrumb = {
  id: number | null;
  name: string;
};

async function buildBreadcrumbs(directoryId: number | null): Promise<Breadcrumb[]> {
  if (directoryId === null) {
    return [{ id: null, name: "/" }];
  }

  const crumbs: Breadcrumb[] = [];
  let currentId: number | null = directoryId;

  while (currentId !== null) {
    const dir: { id: number; name: string; parentId: number | null } | null = await prisma.directory.findUnique({
      where: { id: currentId },
      select: { id: true, name: true, parentId: true }
    });

    if (!dir) {
      break;
    }

    crumbs.unshift({ id: dir.id, name: dir.name });
    currentId = dir.parentId;
  }

  crumbs.unshift({ id: null, name: "/" });
  return crumbs;
}

export async function getDirectoryContext(directoryId: number | null, includeHidden: boolean): Promise<{
  currentDirectory: { id: number; name: string; parentId: number | null; isHidden: boolean } | null;
  parentDirectoryId: number | null;
  breadcrumbs: Breadcrumb[];
  directories: Array<{ id: number; name: string; isHidden: boolean; updatedAt: Date }>;
  files: Array<{
    id: number;
    name: string;
    extension: string;
    sha256: string;
    md5: string;
    uploadAt: Date;
    size: bigint | null;
    lastModified: Date | null;
    isHidden: boolean;
    isFeatured: boolean;
  }>;
}> {
  let currentDirectory: { id: number; name: string; parentId: number | null; isHidden: boolean } | null = null;

  if (directoryId !== null) {
    currentDirectory = await prisma.directory.findUnique({
      where: { id: directoryId },
      select: { id: true, name: true, parentId: true, isHidden: true }
    });

    if (!currentDirectory || (!includeHidden && currentDirectory.isHidden)) {
      throw new Error("Directory not found");
    }
  }

  const dirWhere: Prisma.DirectoryWhereInput = {
    parentId: directoryId
  };

  if (!includeHidden) {
    dirWhere.isHidden = false;
  }

  const fileWhere: Prisma.FileWhereInput = {
    directoryId
  };

  if (!includeHidden) {
    fileWhere.isHidden = false;
  }

  const [directories, files, breadcrumbs] = await Promise.all([
    prisma.directory.findMany({
      where: dirWhere,
      select: { id: true, name: true, isHidden: true, updatedAt: true },
      orderBy: [{ name: "asc" }]
    }),
    prisma.file.findMany({
      where: fileWhere,
      select: {
        id: true,
        name: true,
        extension: true,
        sha256: true,
        md5: true,
        uploadAt: true,
        size: true,
        lastModified: true,
        isHidden: true,
        isFeatured: true
      },
      orderBy: [{ name: "asc" }]
    }),
    buildBreadcrumbs(directoryId)
  ]);

  return {
    currentDirectory,
    parentDirectoryId: currentDirectory?.parentId ?? null,
    breadcrumbs,
    directories,
    files
  };
}
