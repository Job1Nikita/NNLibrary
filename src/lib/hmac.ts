import crypto from "crypto";

function sign(base: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(base).digest("base64url").slice(0, 16);
}

export type CallbackAction = "approve" | "reject" | "ban" | "unban" | "delete";

export function makeSignedCallback(action: CallbackAction, userId: number, secret: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const base = `${action}.${userId}.${ts}`;
  return `${base}.${sign(base, secret)}`;
}

export function verifySignedCallback(
  data: string,
  secret: string,
  maxAgeSeconds = 60 * 60 * 24 * 7
): { valid: true; action: CallbackAction; userId: number } | { valid: false } {
  const parts = data.split(".");
  if (parts.length !== 4) {
    return { valid: false };
  }

  const [actionRaw, userIdRaw, tsRaw, sig] = parts;
  const ts = Number(tsRaw);
  const userId = Number(userIdRaw);
  const action = actionRaw as CallbackAction;

  if (
    !["approve", "reject", "ban", "unban", "delete"].includes(action) ||
    !Number.isInteger(userId) ||
    !Number.isInteger(ts)
  ) {
    return { valid: false };
  }

  const now = Math.floor(Date.now() / 1000);
  if (ts > now + 30 || now - ts > maxAgeSeconds) {
    return { valid: false };
  }

  const base = `${action}.${userId}.${ts}`;
  const expected = sign(base, secret);

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false };
  }

  return { valid: true, action, userId };
}
