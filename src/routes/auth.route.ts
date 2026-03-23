import { Prisma } from "@prisma/client";
import { Request, Response, Router } from "express";
import { prisma } from "../db/prisma";
import { setFlash } from "../lib/flash";
import { getClientIp } from "../lib/ip";
import { hashPassword, verifyPassword } from "../lib/password";
import { loginSchema, registerSchema } from "../lib/validation";
import { authLimiter } from "../middleware/rate-limit";
import { verifyCaptcha } from "../services/captcha.service";
import { sendRegistrationAlert } from "../services/telegram-notify.service";
import { writeAuditLog } from "../services/audit.service";

export const authRouter = Router();

function renderAuthPage(
  view: "login" | "register",
  req: Request,
  res: Response
): void {
  const t = req.t ?? ((key: string) => key);
  if (req.currentUser?.status === "APPROVED") {
    res.redirect("/");
    return;
  }

  res.render(view, {
    title: view === "login" ? t("titles.login") : t("titles.register")
  });
}

authRouter.get("/login", (req, res) => {
  renderAuthPage("login", req, res);
});

authRouter.get("/register", (req, res) => {
  renderAuthPage("register", req, res);
});

authRouter.post("/register", authLimiter, async (req, res) => {
  const t = req.t ?? ((key: string) => key);
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", t("flash.invalidRegisterForm"));
    res.redirect("/register");
    return;
  }

  const { login, password, challengeId, captchaX } = parsed.data;
  if (!verifyCaptcha(req, challengeId, captchaX)) {
    setFlash(req, "error", t("flash.captchaFailed"));
    res.redirect("/register");
    return;
  }

  const normalizedLogin = login.toLowerCase();
  const ip = getClientIp(req);

  try {
    const passwordHash = await hashPassword(password);
    const created = await prisma.user.create({
      data: {
        login: normalizedLogin,
        passwordHash,
        status: "PENDING",
        registrationIp: ip
      },
      select: { id: true, login: true }
    });

    await writeAuditLog({
      actorId: created.id,
      targetUserId: created.id,
      action: "user.register",
      details: `login=${created.login}`,
      ip
    });

    await sendRegistrationAlert(created.id, created.login, ip).catch(() => undefined);
    setFlash(req, "success", t("flash.registerCreated"));
    res.redirect("/login");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      setFlash(req, "error", t("flash.loginTaken"));
      res.redirect("/register");
      return;
    }

    throw error;
  }
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const t = req.t ?? ((key: string) => key);
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, "error", t("flash.invalidLoginForm"));
    res.redirect("/login");
    return;
  }

  const { login, password, challengeId, captchaX } = parsed.data;
  if (!verifyCaptcha(req, challengeId, captchaX)) {
    setFlash(req, "error", t("flash.captchaFailed"));
    res.redirect("/login");
    return;
  }

  const normalizedLogin = login.toLowerCase();
  const user = await prisma.user.findUnique({ where: { login: normalizedLogin } });

  if (!user) {
    setFlash(req, "error", t("flash.invalidCredentials"));
    res.redirect("/login");
    return;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    setFlash(req, "error", t("flash.invalidCredentials"));
    res.redirect("/login");
    return;
  }

  if (user.status === "PENDING") {
    setFlash(req, "info", t("flash.accountPending"));
    res.redirect("/login");
    return;
  }

  if (user.status === "BLOCKED") {
    setFlash(req, "error", t("flash.accountBlocked"));
    res.redirect("/login");
    return;
  }

  req.session.userId = user.id;
  await writeAuditLog({
    actorId: user.id,
    targetUserId: user.id,
    action: "user.login",
    ip: getClientIp(req)
  });

  res.redirect("/");
});

authRouter.post("/logout", (req, res) => {
  const userId = req.session.userId;
  req.session.destroy(() => {
    if (userId) {
      void writeAuditLog({
        actorId: userId,
        targetUserId: userId,
        action: "user.logout",
        ip: getClientIp(req)
      }).catch(() => undefined);
    }
    res.redirect("/login");
  });
});
