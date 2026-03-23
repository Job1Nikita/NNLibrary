import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isIgnoredPath(pathname: string): boolean {
  return pathname.startsWith("/public") || pathname.startsWith("/captcha") || pathname === "/healthz";
}

function getProvidedToken(req: Request): string | undefined {
  const bodyToken = typeof req.body?._csrf === "string" ? req.body._csrf : undefined;
  if (bodyToken) {
    return bodyToken;
  }

  const queryToken = typeof req.query._csrf === "string" ? req.query._csrf : undefined;
  if (queryToken) {
    return queryToken;
  }

  const headerToken = req.get("x-csrf-token");
  return headerToken ?? undefined;
}

function tokenEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function makeCsrfError(): Error & { code: string } {
  const error = new Error("Invalid CSRF token") as Error & { code: string };
  error.code = "EBADCSRFTOKEN";
  return error;
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (isIgnoredPath(req.path)) {
    next();
    return;
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }

  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  const provided = getProvidedToken(req);
  const expected = req.session.csrfToken;
  if (!provided || !expected || !tokenEquals(provided, expected)) {
    next(makeCsrfError());
    return;
  }

  next();
}
