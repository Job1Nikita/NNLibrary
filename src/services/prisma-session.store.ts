import session from "express-session";
import { prisma } from "../db/prisma";

function computeExpiry(sess: session.SessionData): Date {
  const expires = sess.cookie?.expires;
  if (expires instanceof Date && Number.isFinite(expires.getTime())) {
    return expires;
  }

  const maxAge = typeof sess.cookie?.maxAge === "number" ? sess.cookie.maxAge : 1000 * 60 * 60 * 24;
  return new Date(Date.now() + maxAge);
}

export class PrismaSessionStore extends session.Store {
  get(sid: string, callback: (err?: unknown, sessionData?: session.SessionData | null) => void): void {
    void (async () => {
      const record = await prisma.session.findUnique({
        where: { sid },
        select: { data: true, expiresAt: true }
      });

      if (!record) {
        callback(undefined, null);
        return;
      }

      if (record.expiresAt.getTime() <= Date.now()) {
        await prisma.session.delete({ where: { sid } }).catch(() => undefined);
        callback(undefined, null);
        return;
      }

      callback(undefined, JSON.parse(record.data) as session.SessionData);
    })().catch((error) => callback(error));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    void (async () => {
      const expiresAt = computeExpiry(sess);
      await prisma.session.upsert({
        where: { sid },
        update: {
          data: JSON.stringify(sess),
          expiresAt
        },
        create: {
          sid,
          data: JSON.stringify(sess),
          expiresAt
        }
      });
      callback?.();
    })().catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    void prisma.session
      .deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  touch(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    const expiresAt = computeExpiry(sess);
    void prisma.session
      .updateMany({
        where: { sid },
        data: { expiresAt }
      })
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }
}
