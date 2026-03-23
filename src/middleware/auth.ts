import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { setFlash } from "../lib/flash";

export async function attachCurrentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;

  if (!userId) {
    req.currentUser = null;
    res.locals.currentUser = null;
    next();
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    req.session.userId = undefined;
    req.currentUser = null;
    res.locals.currentUser = null;
    next();
    return;
  }

  req.currentUser = user;
  res.locals.currentUser = user;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const t = req.t ?? ((key: string) => key);
  if (!req.currentUser) {
    setFlash(req, "error", t("flash.authRequired"));
    res.redirect("/login");
    return;
  }

  next();
}

export function requireApproved(req: Request, res: Response, next: NextFunction): void {
  const t = req.t ?? ((key: string) => key);
  const user = req.currentUser;
  if (!user) {
    setFlash(req, "error", t("flash.authRequired"));
    res.redirect("/login");
    return;
  }

  if (user.status !== "APPROVED") {
    req.session.userId = undefined;
    setFlash(req, "error", t("flash.accessClosed"));
    res.redirect("/login");
    return;
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const t = req.t ?? ((key: string) => key);
  const user = req.currentUser;
  if (!user || user.role !== "ADMIN") {
    res.status(403).render("error", {
      title: t("errors.forbidden"),
      code: 403,
      message: t("errors.insufficientRights")
    });
    return;
  }

  next();
}
