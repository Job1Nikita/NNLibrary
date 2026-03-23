import fs from "fs/promises";
import path from "path";
import { Router } from "express";
import { prisma } from "../db/prisma";
import { setFlash } from "../lib/flash";
import { getClientIp } from "../lib/ip";
import { commentSchema } from "../lib/validation";
import { requireApproved, requireAuth } from "../middleware/auth";
import { isAdminIpAllowed } from "../middleware/admin-ip";
import { downloadLimiter } from "../middleware/rate-limit";
import { env } from "../config/env";
import { getDirectoryContext } from "../services/directory.service";
import { getActiveNotice } from "../services/notice.service";
import { normalizeRelativeStoragePath, resolveStorageAbsolutePath } from "../lib/storage";

export const portalRouter = Router();

portalRouter.use(requireAuth, requireApproved);

portalRouter.get("/", async (req, res) => {
  const t = req.t ?? ((key: string) => key);
  const isAdminUser = req.currentUser?.role === "ADMIN";
  const includeHidden = isAdminUser;
  const isAdminToolsAllowed = isAdminUser && isAdminIpAllowed(req);
  const notice = await getActiveNotice();

  const [context, moveDirectories] = await Promise.all([
    getDirectoryContext(null, includeHidden),
    isAdminToolsAllowed
      ? prisma.directory.findMany({
          select: { id: true, name: true, parentId: true },
          orderBy: [{ name: "asc" }]
        })
      : Promise.resolve([])
  ]);

  res.render("listing", {
    title: t("titles.archiveRoot"),
    ...context,
    notice,
    isAdmin: isAdminToolsAllowed,
    moveDirectories
  });
});

portalRouter.get("/dir/:id", async (req, res) => {
  const t = req.t ?? ((key: string) => key);
  const isAdminUser = req.currentUser?.role === "ADMIN";
  const includeHidden = isAdminUser;
  const isAdminToolsAllowed = isAdminUser && isAdminIpAllowed(req);
  const notice = await getActiveNotice();

  const dirId = Number(req.params.id);
  if (!Number.isInteger(dirId) || dirId <= 0) {
    res.status(404).render("error", {
      title: t("titles.directory"),
      code: 404,
      message: t("errors.directoryNotFound")
    });
    return;
  }

  try {
    const [context, moveDirectories] = await Promise.all([
      getDirectoryContext(dirId, includeHidden),
      isAdminToolsAllowed
        ? prisma.directory.findMany({
            select: { id: true, name: true, parentId: true },
            orderBy: [{ name: "asc" }]
          })
        : Promise.resolve([])
    ]);

    res.render("listing", {
      title: context.currentDirectory ? context.currentDirectory.name : t("titles.archiveDirectory"),
      ...context,
      notice,
      isAdmin: isAdminToolsAllowed,
      moveDirectories
    });
  } catch {
    res.status(404).render("error", {
      title: t("titles.directory"),
      code: 404,
      message: t("errors.directoryNotFound")
    });
  }
});

portalRouter.get("/file/:id", async (req, res) => {
  const t = req.t ?? ((key: string) => key);
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(404).render("error", {
      title: t("titles.file"),
      code: 404,
      message: t("errors.fileNotFound")
    });
    return;
  }

  const file = await prisma.file.findUnique({
    where: { id: fileId },
    include: {
      directory: { select: { id: true, name: true } },
      comments: {
        include: {
          user: { select: { id: true, login: true } }
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  const includeHidden = req.currentUser?.role === "ADMIN";
  if (!file || (!includeHidden && file.isHidden)) {
    res.status(404).render("error", {
      title: t("titles.file"),
      code: 404,
      message: t("errors.fileNotFound")
    });
    return;
  }

  const notice = await getActiveNotice();
  res.render("file", {
    title: file.name,
    file,
    notice
  });
});

portalRouter.post("/file/:id/comment", async (req, res) => {
  const t = req.t ?? ((key: string) => key);
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(404).render("error", {
      title: t("titles.file"),
      code: 404,
      message: t("errors.fileNotFound")
    });
    return;
  }

  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", t("flash.commentInvalid"));
    res.redirect(`/file/${fileId}`);
    return;
  }

  const file = await prisma.file.findUnique({ where: { id: fileId }, select: { id: true, isHidden: true } });
  const includeHidden = req.currentUser?.role === "ADMIN";
  if (!file || (!includeHidden && file.isHidden)) {
    res.status(404).render("error", {
      title: t("titles.file"),
      code: 404,
      message: t("errors.fileNotFound")
    });
    return;
  }

  await prisma.comment.create({
    data: {
      fileId,
      userId: req.currentUser!.id,
      content: parsed.data.content
    }
  });

  setFlash(req, "success", t("flash.commentAdded"));
  res.redirect(`/file/${fileId}`);
});

portalRouter.get("/download/:fileId", downloadLimiter, async (req, res) => {
  const t = req.t ?? ((key: string) => key);
  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(404).render("error", {
      title: t("titles.download"),
      code: 404,
      message: t("errors.fileNotFound")
    });
    return;
  }

  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      name: true,
      relativePath: true,
      isHidden: true
    }
  });

  const includeHidden = req.currentUser?.role === "ADMIN";
  if (!file || (!includeHidden && file.isHidden)) {
    res.status(404).render("error", {
      title: t("titles.download"),
      code: 404,
      message: t("errors.fileNotFound")
    });
    return;
  }

  const relativePath = normalizeRelativeStoragePath(file.relativePath);
  const absolutePath = resolveStorageAbsolutePath(env.STORAGE_ROOT, relativePath);

  try {
    await fs.access(absolutePath);
  } catch {
    res.status(404).render("error", {
      title: t("titles.download"),
      code: 404,
      message: t("errors.downloadFileNotFound")
    });
    return;
  }

  await prisma.downloadLog.create({
    data: {
      userId: req.currentUser!.id,
      fileId: file.id,
      ip: getClientIp(req),
      userAgent: req.get("user-agent") ?? null
    }
  });

  const accelRelative = relativePath.split(path.posix.sep).map(encodeURIComponent).join("/");
  const safeName = file.name.replace(/"/g, "");

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("X-Accel-Redirect", `/_protected/${accelRelative}`);
  res.status(200).end();
});
