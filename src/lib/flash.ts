import type { Request } from "express";

type FlashType = "success" | "error" | "info";

export function setFlash(req: Request, type: FlashType, message: string): void {
  req.session.flash = { type, message };
}

export function consumeFlash(req: Request): { type: FlashType; message: string } | null {
  const flash = req.session.flash ?? null;
  delete req.session.flash;
  return flash;
}
