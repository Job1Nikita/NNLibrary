import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";
import { getClientIp } from "../lib/ip";

const SKIP_PREFIXES = ["/public", "/captcha", "/favicon", "/healthz"];

export async function visitLogger(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (req.method !== "GET" || SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    next();
    return;
  }

  try {
    await prisma.visitLog.create({
      data: {
        userId: req.currentUser?.id ?? null,
        path: req.path,
        ip: getClientIp(req),
        userAgent: req.get("user-agent") ?? null
      }
    });
  } catch {
    // Avoid breaking request flow due to telemetry write issues.
  }

  next();
}
