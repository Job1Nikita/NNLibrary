import fs from "fs/promises";
import fsSync from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { Prisma } from "@prisma/client";
import { Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { computeFileHashesAndStats } from "../lib/hash";
import { setFlash } from "../lib/flash";
import { getClientIp } from "../lib/ip";
import {
  directoryCreateSchema,
  fileRegisterSchema,
  fileUploadSchema,
  noticeSchema,
  userActionSchema
} from "../lib/validation";
import { restrictAdminByIp } from "../middleware/admin-ip";
import { requireAdmin, requireApproved, requireAuth } from "../middleware/auth";
import { uploadLimiter } from "../middleware/rate-limit";
import { scanFileWithAntivirus } from "../services/av.service";
import { publishNotice, clearNotices } from "../services/notice.service";
import { moderateUser } from "../services/user-admin.service";
import { normalizeRelativeStoragePath, resolveStorageAbsolutePath } from "../lib/storage";
import { writeAuditLog } from "../services/audit.service";

const directoryEditSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[^/\\]+$/),
  isHidden: z.union([z.literal("true"), z.literal("false")])
});

const directoryParentSchema = z.object({
  parentId: z.union([z.literal(""), z.coerce.number().int().positive()]).optional()
});

const directoryRenameSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[^/\\]+$/)
});

const directoryMoveSchema = z.object({
  parentId: z.union([z.literal(""), z.coerce.number().int().positive()]).optional()
});

const fileRenameSchema = z.object({
  name: z.string().trim().min(1).max(255)
});

const fileMoveSchema = z.object({
  directoryId: z.union([z.literal(""), z.coerce.number().int().positive()]).optional()
});

const fileFeatureSchema = z.object({
  isFeatured: z.union([z.literal("true"), z.literal("false")])
});

const uploadTempDir = path.join(process.cwd(), "tmp", "uploads");
const MAX_FILES_PER_UPLOAD = 20;

function tr(req: Request, key: string, params?: Record<string, string | number | null | undefined>): string {
  if (req.t) {
    return req.t(key, params);
  }
  return key;
}

function decodeMultipartFileName(rawName: string): string {
  const input = (rawName || "").trim();
  if (!input) {
    return "";
  }

  if (/^[\x00-\x7F]+$/.test(input)) {
    return input;
  }

  const decoded = Buffer.from(input, "latin1").toString("utf8");
  if (!decoded || decoded.includes("\uFFFD")) {
    return input;
  }

  const inputCyr = (input.match(/[А-Яа-яЁё]/g) || []).length;
  const decodedCyr = (decoded.match(/[А-Яа-яЁё]/g) || []).length;
  const looksLikeMojibake = /[ÐÑÃ]/.test(input);

  if (looksLikeMojibake || decodedCyr > inputCyr) {
    return decoded.trim();
  }

  return input;
}

const uploadMulter = multer({
  storage: multer.diskStorage({
    destination: (
      _req: Request,
      _file: Express.Multer.File,
      cb: (error: Error | null, destination: string) => void
    ) => {
      try {
        fsSync.mkdirSync(uploadTempDir, { recursive: true });
        cb(null, uploadTempDir);
      } catch (error) {
        cb(error as Error, uploadTempDir);
      }
    },
    filename: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, filename: string) => void
    ) => {
      const originalName = decodeMultipartFileName(file.originalname || "");
      const ext = path.extname(originalName);
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    }
  }),
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: MAX_FILES_PER_UPLOAD
  }
});

function sanitizeFileName(input: string): string {
  const base = path
    .basename(input)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  if (!base || base === "." || base === "..") {
    throw new Error("invalid file name");
  }

  return base;
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code !== "EXDEV") {
      throw error;
    }

    await fs.copyFile(sourcePath, targetPath);
    await fs.unlink(sourcePath);
  }
}

async function runMultiUpload(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    uploadMulter.array("binaryFile", MAX_FILES_PER_UPLOAD)(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function cleanupTempFile(filePath: string | null): Promise<void> {
  if (!filePath) {
    return;
  }

  await fs.unlink(filePath).catch(() => undefined);
}

async function cleanupTempFiles(filePaths: string[]): Promise<void> {
  await Promise.all(filePaths.map((filePath) => cleanupTempFile(filePath)));
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  return normalizedCandidate.startsWith(rootWithSep);
}

async function pruneEmptyStorageDirs(startDir: string): Promise<void> {
  const storageRoot = path.resolve(env.STORAGE_ROOT);
  let currentDir = path.resolve(startDir);

  while (currentDir !== storageRoot && isPathInsideRoot(currentDir, storageRoot)) {
    try {
      await fs.rmdir(currentDir);
      currentDir = path.dirname(currentDir);
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (e.code === "ENOTEMPTY" || e.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function deleteStorageFileByRelativePath(relativePath: string): Promise<"deleted" | "missing"> {
  const normalized = normalizeRelativeStoragePath(relativePath);
  const absolutePath = resolveStorageAbsolutePath(env.STORAGE_ROOT, normalized);

  try {
    await fs.unlink(absolutePath);
    await pruneEmptyStorageDirs(path.dirname(absolutePath)).catch(() => undefined);
    return "deleted";
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

function collectDirectoryTreeIds(
  rootId: number,
  allDirectories: Array<{ id: number; parentId: number | null }>
): number[] {
  const ids: number[] = [];
  const queue: number[] = [rootId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    ids.push(current);

    for (const directory of allDirectories) {
      if (directory.parentId === current) {
        queue.push(directory.id);
      }
    }
  }

  return ids;
}

function redirectToReferrer(req: Request, res: Response, fallback = "/admin"): void {
  const returnTo = typeof req.body?.returnTo === "string" ? req.body.returnTo.trim() : "";
  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    try {
      const safeUrl = new URL(returnTo, "http://localhost");
      res.redirect(`${safeUrl.pathname}${safeUrl.search}`);
      return;
    } catch {
      // ignore malformed returnTo and fallback to referer/fallback
    }
  }

  const referer = req.get("referer");
  if (!referer) {
    res.redirect(fallback);
    return;
  }

  try {
    const url = new URL(referer);
    res.redirect(`${url.pathname}${url.search}`);
  } catch {
    res.redirect(fallback);
  }
}

export const adminRouter = Router();

adminRouter.use("/admin", restrictAdminByIp, requireAuth, requireApproved, requireAdmin);

adminRouter.get("/admin", async (req, res) => {
  const [users, directories, files, pendingCount, notice] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, login: true, role: true, status: true, createdAt: true, registrationIp: true }
    }),
    prisma.directory.findMany({
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
      select: { id: true, name: true, parentId: true, isHidden: true }
    }),
    prisma.file.findMany({
      orderBy: { uploadAt: "desc" },
      take: 200,
      include: { directory: { select: { id: true, name: true } } }
    }),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.siteNotice.findFirst({ where: { isActive: true }, orderBy: { createdAt: "desc" } })
  ]);

  res.render("admin/index", {
    title: tr(req, "titles.admin"),
    users,
    directories,
    files,
    pendingCount,
    activeNotice: notice
  });
});

adminRouter.post("/admin/users/:id/action", async (req, res) => {
  const targetUserId = Number(req.params.id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).send(tr(req, "errors.invalidUserId"));
    return;
  }

  const parsed = userActionSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.adminInvalidAction"));
    res.redirect("/admin");
    return;
  }

  if (targetUserId === req.currentUser!.id && parsed.data.action === "ban") {
    setFlash(req, "error", tr(req, "flash.adminCannotBanSelf"));
    res.redirect("/admin");
    return;
  }

  await moderateUser(targetUserId, parsed.data.action, req.currentUser!.id, getClientIp(req));
  setFlash(req, "success", tr(req, "flash.adminActionDone", { action: parsed.data.action }));
  res.redirect("/admin");
});

adminRouter.post("/admin/directories", async (req, res) => {
  const base = directoryCreateSchema.safeParse(req.body);
  const parent = directoryParentSchema.safeParse(req.body);

  if (!base.success || !parent.success) {
    setFlash(req, "error", tr(req, "flash.adminInvalidDirectoryData"));
    redirectToReferrer(req, res);
    return;
  }

  const parentId = parent.data.parentId === "" || parent.data.parentId === undefined ? null : parent.data.parentId;

  await prisma.directory.create({
    data: {
      name: base.data.name,
      parentId
    }
  });

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "directory.create",
    details: `name=${base.data.name};parent=${parentId ?? "root"}`,
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.dirCreated"));
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/directories/:id", async (req, res) => {
  const directoryId = Number(req.params.id);
  if (!Number.isInteger(directoryId) || directoryId <= 0) {
    res.status(400).send(tr(req, "errors.invalidDirectoryId"));
    return;
  }

  const parsed = directoryEditSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.adminInvalidDirectoryData"));
    res.redirect("/admin");
    return;
  }

  const isHidden = parsed.data.isHidden === "true";

  await prisma.directory.update({
    where: { id: directoryId },
    data: {
      name: parsed.data.name,
      isHidden
    }
  });

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "directory.update",
    details: `id=${directoryId};name=${parsed.data.name};hidden=${isHidden}`,
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.dirUpdated"));
  res.redirect("/admin");
});

adminRouter.post("/admin/directories/:id/rename", async (req, res) => {
  const directoryId = Number(req.params.id);
  if (!Number.isInteger(directoryId) || directoryId <= 0) {
    res.status(400).send(tr(req, "errors.invalidDirectoryId"));
    return;
  }

  const parsed = directoryRenameSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.invalidDirName"));
    redirectToReferrer(req, res);
    return;
  }

  try {
    await prisma.directory.update({
      where: { id: directoryId },
      data: { name: parsed.data.name }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      setFlash(req, "error", tr(req, "flash.dirNotFound"));
      redirectToReferrer(req, res);
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      setFlash(req, "error", tr(req, "flash.dirDuplicate"));
      redirectToReferrer(req, res);
      return;
    }
    throw error;
  }

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "directory.rename",
    details: `id=${directoryId};name=${parsed.data.name}`,
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.dirRenamed"));
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/directories/:id/move", async (req, res) => {
  const directoryId = Number(req.params.id);
  if (!Number.isInteger(directoryId) || directoryId <= 0) {
    res.status(400).send(tr(req, "errors.invalidDirectoryId"));
    return;
  }

  const parsed = directoryMoveSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.invalidParentId"));
    redirectToReferrer(req, res);
    return;
  }

  const parentId = parsed.data.parentId === "" || parsed.data.parentId === undefined ? null : parsed.data.parentId;
  if (parentId === directoryId) {
    setFlash(req, "error", tr(req, "flash.dirMoveSelf"));
    redirectToReferrer(req, res);
    return;
  }

  const allDirectories = await prisma.directory.findMany({
    select: { id: true, parentId: true }
  });

  const targetExists = allDirectories.some((directory) => directory.id === directoryId);
  if (!targetExists) {
    setFlash(req, "error", tr(req, "flash.dirNotFound"));
    redirectToReferrer(req, res);
    return;
  }

  if (parentId !== null && !allDirectories.some((directory) => directory.id === parentId)) {
    setFlash(req, "error", tr(req, "flash.dirTargetNotFound"));
    redirectToReferrer(req, res);
    return;
  }

  const descendants = collectDirectoryTreeIds(directoryId, allDirectories);
  if (parentId !== null && descendants.includes(parentId)) {
    setFlash(req, "error", tr(req, "flash.dirMoveIntoChild"));
    redirectToReferrer(req, res);
    return;
  }

  try {
    await prisma.directory.update({
      where: { id: directoryId },
      data: { parentId }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      setFlash(req, "error", tr(req, "flash.dirNotFound"));
      redirectToReferrer(req, res);
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      setFlash(req, "error", tr(req, "flash.dirMoveDuplicate"));
      redirectToReferrer(req, res);
      return;
    }
    throw error;
  }

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "directory.move",
    details: `id=${directoryId};parent=${parentId ?? "root"}`,
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.dirMoved"));
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/directories/:id/delete", async (req, res) => {
  const directoryId = Number(req.params.id);
  if (!Number.isInteger(directoryId) || directoryId <= 0) {
    res.status(400).send(tr(req, "errors.invalidDirectoryId"));
    return;
  }

  const [targetDirectory, allDirectories] = await Promise.all([
    prisma.directory.findUnique({
      where: { id: directoryId },
      select: { id: true, name: true }
    }),
    prisma.directory.findMany({
      select: { id: true, parentId: true }
    })
  ]);

  if (!targetDirectory) {
    setFlash(req, "error", tr(req, "flash.dirNotFound"));
    redirectToReferrer(req, res);
    return;
  }

  const directoryTreeIds = collectDirectoryTreeIds(directoryId, allDirectories);
  const filesToDelete = await prisma.file.findMany({
    where: { directoryId: { in: directoryTreeIds } },
    select: { id: true, relativePath: true }
  });

  let missingFiles = 0;
  try {
    for (const file of filesToDelete) {
      const status = await deleteStorageFileByRelativePath(file.relativePath);
      if (status === "missing") {
        missingFiles += 1;
      }
    }
  } catch (error) {
    setFlash(
      req,
      "error",
      tr(req, "flash.storageDeleteError", { message: error instanceof Error ? error.message : "unknown" })
    );
    redirectToReferrer(req, res);
    return;
  }

  await prisma.$transaction([
    prisma.file.deleteMany({ where: { directoryId: { in: directoryTreeIds } } }),
    prisma.directory.deleteMany({ where: { id: { in: directoryTreeIds } } })
  ]);

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "directory.delete",
    details: `id=${directoryId};name=${targetDirectory.name};dirs=${directoryTreeIds.length};files=${filesToDelete.length};missing=${missingFiles}`,
    ip: getClientIp(req)
  });

  setFlash(
    req,
    "success",
    missingFiles > 0
      ? tr(req, "flash.dirDeletedWithMissing", { count: missingFiles })
      : tr(req, "flash.dirDeleted")
  );
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/files/upload", uploadLimiter, async (req, res) => {
  const uploadReq = req as Request & { files?: Express.Multer.File[] };
  let tempPaths: string[] = [];
  let uploadedFiles: Express.Multer.File[] = [];

  try {
    await runMultiUpload(uploadReq, res);
    uploadedFiles = Array.isArray(uploadReq.files) ? uploadReq.files : [];
    tempPaths = uploadedFiles.map((file) => file.path);
  } catch (error) {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      setFlash(req, "error", tr(req, "flash.fileTooLarge", { size: env.MAX_UPLOAD_SIZE_MB }));
      redirectToReferrer(req, res);
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
      setFlash(req, "error", tr(req, "flash.tooManyFiles", { count: MAX_FILES_PER_UPLOAD }));
      redirectToReferrer(req, res);
      return;
    }

    setFlash(req, "error", tr(req, "flash.multipartError"));
    redirectToReferrer(req, res);
    return;
  }

  try {
    const parsed = fileUploadSchema.safeParse(req.body);
    if (!parsed.success || uploadedFiles.length === 0) {
      await cleanupTempFiles(tempPaths);
      setFlash(req, "error", tr(req, "flash.invalidUploadForm"));
      redirectToReferrer(req, res);
      return;
    }

    if (parsed.data.visibleName?.trim() && uploadedFiles.length > 1) {
      await cleanupTempFiles(tempPaths);
      setFlash(req, "error", tr(req, "flash.visibleNameSingleOnly"));
      redirectToReferrer(req, res);
      return;
    }

    const directoryId =
      parsed.data.directoryId === "" || parsed.data.directoryId === undefined ? null : parsed.data.directoryId;

    if (directoryId) {
      const dir = await prisma.directory.findUnique({ where: { id: directoryId }, select: { id: true } });
      if (!dir) {
        await cleanupTempFiles(tempPaths);
        setFlash(req, "error", tr(req, "flash.portalDirNotFound"));
        redirectToReferrer(req, res);
        return;
      }
    }

    const rawSubdir = parsed.data.storageSubdir?.trim() ?? "";
    const storageSubdir = rawSubdir ? normalizeRelativeStoragePath(rawSubdir) : "";
    const overwrite = parsed.data.overwrite === "on" || parsed.data.overwrite === "true";

    const successfulUploads: Array<{ relativePath: string; id: number }> = [];
    const failedUploads: string[] = [];

    for (const uploadedFile of uploadedFiles) {
      let moved = false;
      const originalUploadName = decodeMultipartFileName(uploadedFile.originalname || "");
      const inputVisibleName = uploadedFiles.length === 1 ? parsed.data.visibleName?.trim() : "";
      const sourceName = inputVisibleName || originalUploadName || uploadedFile.filename;

      try {
        const visibleName = sanitizeFileName(sourceName);
        const relativePath = normalizeRelativeStoragePath(storageSubdir ? `${storageSubdir}/${visibleName}` : visibleName);
        const absolutePath = resolveStorageAbsolutePath(env.STORAGE_ROOT, relativePath);

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });

        if (!overwrite) {
          const exists = await fs
            .access(absolutePath)
            .then(() => true)
            .catch(() => false);

          if (exists) {
            throw new Error(tr(req, "flash.fileExists"));
          }
        } else {
          await fs.rm(absolutePath, { force: true });
        }

        const avResult = await scanFileWithAntivirus(uploadedFile.path);
        if (avResult.status === "infected") {
          await writeAuditLog({
            actorId: req.currentUser!.id,
            action: "file.upload_blocked_malware",
            details: `path=${relativePath};details=${avResult.details.slice(0, 500)}`,
            ip: getClientIp(req)
          });
          throw new Error(tr(req, "flash.uploadBlockedMalware"));
        }

        if (avResult.status === "unavailable") {
          await writeAuditLog({
            actorId: req.currentUser!.id,
            action: "file.upload_av_unavailable",
            details: `path=${relativePath};details=${avResult.details.slice(0, 500)}`,
            ip: getClientIp(req)
          });
        }

        await moveFile(uploadedFile.path, absolutePath);
        moved = true;
        tempPaths = tempPaths.filter((value) => value !== uploadedFile.path);

        const { sha256, md5, size, lastModified } = await computeFileHashesAndStats(absolutePath);
        const extension = path.extname(visibleName).replace(/^\./, "").toLowerCase();

        const fileRecord = await prisma.file.upsert({
          where: { relativePath },
          update: {
            directoryId,
            name: visibleName,
            extension,
            sha256,
            md5,
            size,
            lastModified,
            uploadAt: new Date(),
            isHidden: false
          },
          create: {
            directoryId,
            relativePath,
            name: visibleName,
            extension,
            sha256,
            md5,
            size,
            lastModified,
            uploadAt: new Date(),
            isHidden: false
          }
        });

        await writeAuditLog({
          actorId: req.currentUser!.id,
          action: overwrite ? "file.upload_overwrite" : "file.upload",
          details: `path=${relativePath};dir=${directoryId ?? "root"};size=${size.toString()}`,
          ip: getClientIp(req)
        });

        successfulUploads.push({ relativePath, id: fileRecord.id });
      } catch (error) {
        let message = error instanceof Error ? error.message : "unknown error";
        if (message === "invalid file name") {
          message = tr(req, "flash.invalidFileName");
        }
        failedUploads.push(`${sourceName}: ${message}`);

        if (moved) {
          // Keep already persisted file on disk/DB; report failure only for this item.
          continue;
        }

        await cleanupTempFile(uploadedFile.path);
        tempPaths = tempPaths.filter((value) => value !== uploadedFile.path);
      }
    }

    await cleanupTempFiles(tempPaths);

    if (successfulUploads.length === 0) {
      const details = failedUploads.slice(0, 2).join("; ");
      setFlash(req, "error", tr(req, "flash.uploadNoneSucceeded", { details: details ? `: ${details}` : "" }));
      redirectToReferrer(req, res);
      return;
    }

    if (failedUploads.length > 0) {
      const details = failedUploads.slice(0, 2).join("; ");
      const extra = failedUploads.length > 2 ? ` (+${failedUploads.length - 2})` : "";
      setFlash(
        req,
        "info",
        tr(req, "flash.uploadPartial", {
          ok: successfulUploads.length,
          total: uploadedFiles.length,
          details,
          extra
        })
      );
      redirectToReferrer(req, res);
      return;
    }

    if (successfulUploads.length === 1) {
      const [single] = successfulUploads;
      setFlash(req, "success", tr(req, "flash.uploadSingleSuccess", { path: single.relativePath }));
      redirectToReferrer(req, res, `/file/${single.id}`);
      return;
    }

    setFlash(req, "success", tr(req, "flash.uploadManySuccess", { count: successfulUploads.length }));
    redirectToReferrer(req, res);
  } catch (error) {
    await cleanupTempFiles(tempPaths);
    setFlash(
      req,
      "error",
      tr(req, "flash.uploadError", { message: error instanceof Error ? error.message : "unknown" })
    );
    redirectToReferrer(req, res);
  }
});

adminRouter.post("/admin/files/register", async (req, res) => {
  const parsed = fileRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.invalidRegisterFileData"));
    redirectToReferrer(req, res);
    return;
  }

  const relativePath = normalizeRelativeStoragePath(parsed.data.relativePath);
  const absolutePath = resolveStorageAbsolutePath(env.STORAGE_ROOT, relativePath);

  try {
    await fs.access(absolutePath);
  } catch {
    setFlash(req, "error", tr(req, "flash.storageFileNotFound"));
    redirectToReferrer(req, res);
    return;
  }

  const { sha256, md5, size, lastModified } = await computeFileHashesAndStats(absolutePath);
  const visibleName = parsed.data.visibleName?.trim() || path.basename(relativePath);
  const extension = path.extname(visibleName).replace(/^\./, "").toLowerCase();

  const directoryId =
    parsed.data.directoryId === "" || parsed.data.directoryId === undefined ? null : parsed.data.directoryId;

  await prisma.file.upsert({
    where: { relativePath },
    update: {
      directoryId,
      name: visibleName,
      extension,
      sha256,
      md5,
      size,
      lastModified,
      uploadAt: new Date()
    },
    create: {
      directoryId,
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

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "file.register",
    details: `path=${relativePath};dir=${directoryId ?? "root"}`,
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.fileRegistered"));
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/files/:id/rename", async (req, res) => {
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(400).send(tr(req, "errors.invalidFileId"));
    return;
  }

  const parsed = fileRenameSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.invalidFileName"));
    redirectToReferrer(req, res);
    return;
  }

  const visibleName = sanitizeFileName(parsed.data.name);
  const extension = path.extname(visibleName).replace(/^\./, "").toLowerCase();

  try {
    await prisma.file.update({
      where: { id: fileId },
      data: {
        name: visibleName,
        extension
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      setFlash(req, "error", tr(req, "errors.fileNotFound"));
      redirectToReferrer(req, res);
      return;
    }
    throw error;
  }

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "file.rename",
    details: `id=${fileId};name=${visibleName}`,
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.fileRenamed"));
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/files/:id/move", async (req, res) => {
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(400).send(tr(req, "errors.invalidFileId"));
    return;
  }

  const parsed = fileMoveSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.invalidDirectoryId"));
    redirectToReferrer(req, res);
    return;
  }

  const directoryId =
    parsed.data.directoryId === "" || parsed.data.directoryId === undefined ? null : parsed.data.directoryId;

  if (directoryId !== null) {
    const targetDirectory = await prisma.directory.findUnique({
      where: { id: directoryId },
      select: { id: true }
    });

    if (!targetDirectory) {
      setFlash(req, "error", tr(req, "flash.dirTargetNotFound"));
      redirectToReferrer(req, res);
      return;
    }
  }

  try {
    await prisma.file.update({
      where: { id: fileId },
      data: { directoryId }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      setFlash(req, "error", tr(req, "errors.fileNotFound"));
      redirectToReferrer(req, res);
      return;
    }
    throw error;
  }

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "file.move",
    details: `id=${fileId};directory=${directoryId ?? "root"}`,
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.fileMoved"));
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/files/:id/feature", async (req, res) => {
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(400).send(tr(req, "errors.invalidFileId"));
    return;
  }

  const parsed = fileFeatureSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.invalidFileFeature"));
    redirectToReferrer(req, res);
    return;
  }

  const isFeatured = parsed.data.isFeatured === "true";

  try {
    await prisma.file.update({
      where: { id: fileId },
      data: { isFeatured }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      setFlash(req, "error", tr(req, "errors.fileNotFound"));
      redirectToReferrer(req, res);
      return;
    }
    throw error;
  }

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: isFeatured ? "file.feature.on" : "file.feature.off",
    details: `id=${fileId}`,
    ip: getClientIp(req)
  });

  setFlash(req, "success", isFeatured ? tr(req, "flash.fileFeaturedOn") : tr(req, "flash.fileFeaturedOff"));
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/files/:id/delete", async (req, res) => {
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(400).send(tr(req, "errors.invalidFileId"));
    return;
  }

  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: { id: true, name: true, relativePath: true }
  });

  if (!file) {
    setFlash(req, "error", tr(req, "errors.fileNotFound"));
    redirectToReferrer(req, res);
    return;
  }

  let status: "deleted" | "missing";
  try {
    status = await deleteStorageFileByRelativePath(file.relativePath);
  } catch (error) {
    setFlash(
      req,
      "error",
      tr(req, "flash.storageDeleteError", { message: error instanceof Error ? error.message : "unknown" })
    );
    redirectToReferrer(req, res);
    return;
  }

  await prisma.file.delete({ where: { id: file.id } });

  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "file.delete",
    details: `id=${file.id};name=${file.name};path=${file.relativePath};storage=${status}`,
    ip: getClientIp(req)
  });

  setFlash(
    req,
    "success",
    status === "missing"
      ? tr(req, "flash.fileDeletedMissing")
      : tr(req, "flash.fileDeleted")
  );
  redirectToReferrer(req, res);
});

adminRouter.post("/admin/notice", async (req, res) => {
  const parsed = noticeSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", tr(req, "flash.invalidNoticeText"));
    res.redirect("/admin");
    return;
  }

  await publishNotice(parsed.data.text, req.currentUser!.id);
  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "notice.publish",
    details: parsed.data.text,
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.noticePublished"));
  res.redirect("/admin");
});

adminRouter.post("/admin/notice/clear", async (req, res) => {
  await clearNotices();
  await writeAuditLog({
    actorId: req.currentUser!.id,
    action: "notice.clear",
    ip: getClientIp(req)
  });

  setFlash(req, "success", tr(req, "flash.noticeCleared"));
  res.redirect("/admin");
});
