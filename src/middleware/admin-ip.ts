import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { getClientIp } from "../lib/ip";

function normalizeIp(ip: string): string {
  if (ip.startsWith("::ffff:")) {
    return ip.slice(7);
  }
  if (ip === "::1") {
    return "127.0.0.1";
  }
  return ip;
}

const allowedIps = env.ADMIN_ALLOWED_IPS
  .split(",")
  .map((value) => normalizeIp(value.trim()))
  .filter((value) => value.length > 0);

const allowlistEnabled = allowedIps.length > 0;

export function isAdminIpAllowed(req: Request): boolean {
  if (!allowlistEnabled) {
    return true;
  }

  const currentIp = normalizeIp(getClientIp(req));
  return allowedIps.includes(currentIp);
}

export function restrictAdminByIp(req: Request, res: Response, next: NextFunction): void {
  const t = req.t ?? ((key: string) => key);
  if (isAdminIpAllowed(req)) {
    next();
    return;
  }

  const currentIp = normalizeIp(getClientIp(req));

  res.status(403).render("error", {
    title: t("errors.forbidden"),
    code: 403,
    message: t("errors.adminIpDenied", { ip: currentIp })
  });
}
