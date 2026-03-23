import path from "path";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import morgan from "morgan";
import { authRouter } from "./routes/auth.route";
import { captchaRouter } from "./routes/captcha.route";
import { portalRouter } from "./routes/portal.route";
import { adminRouter } from "./routes/admin.route";
import { env, isProd } from "./config/env";
import { attachCurrentUser } from "./middleware/auth";
import { csrfProtection } from "./middleware/csrf";
import { consumeFlash } from "./lib/flash";
import { ensureSqliteWal } from "./db/prisma";
import { PrismaSessionStore } from "./services/prisma-session.store";
import { visitLogger } from "./services/visit.service";
import {
  SUPPORTED_LOCALES,
  buildLanguageUrl,
  createTranslator,
  getLocaleTag,
  resolveRequestLocale,
  setLocaleCookie
} from "./i18n";

const app = express();

app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "src", "views"));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'none'"],
        "frame-ancestors": ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(morgan("combined"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "1mb" }));

app.use(
  session({
    store: new PrismaSessionStore(),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "library.sid",
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

app.use((req, res, next) => {
  const locale = resolveRequestLocale(req);
  const t = createTranslator(locale);

  req.locale = locale;
  req.t = t;

  const queryLang = req.query?.lang;
  const hasLangQuery = typeof queryLang === "string" || (Array.isArray(queryLang) && queryLang.length > 0);
  const hasLocaleCookie = (req.headers.cookie ?? "")
    .split(";")
    .some((part) => part.trim().startsWith("library.lang="));
  if (hasLangQuery || !hasLocaleCookie) {
    setLocaleCookie(res, locale, isProd);
  }

  res.locals.lang = locale;
  res.locals.t = t;
  res.locals.langOptions = SUPPORTED_LOCALES.map((code) => ({
    code,
    label: t(`locale.${code}`),
    url: buildLanguageUrl(req, code),
    active: code === locale
  }));

  next();
});

app.use(attachCurrentUser);
app.use(visitLogger);
app.use(csrfProtection);

app.use((req, res, next) => {
  const locale = req.locale ?? "ru";
  const t = req.t ?? createTranslator(locale);
  const wantsHtml = (req.headers.accept ?? "").includes("text/html");

  res.locals.csrfToken = req.session.csrfToken ?? "";
  res.locals.flash = wantsHtml ? consumeFlash(req) : null;
  res.locals.currentUser = req.currentUser ?? null;
  res.locals.formatDate = (value: Date | string | null) => {
    if (!value) {
      return "-";
    }
    const date = typeof value === "string" ? new Date(value) : value;
    return new Intl.DateTimeFormat(getLocaleTag(locale), {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  };
  res.locals.formatSize = (size: bigint | number | null) => {
    if (size === null || size === undefined) {
      return "-";
    }

    const n = typeof size === "bigint" ? Number(size) : size;
    if (!Number.isFinite(n) || n < 0) {
      return "-";
    }

    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  res.locals.formatUserRole = (role: string) => {
    if (role === "ADMIN") {
      return t("roles.admin");
    }
    return t("roles.user");
  };

  res.locals.formatUserStatus = (status: string) => {
    if (status === "PENDING") return t("status.pending");
    if (status === "APPROVED") return t("status.approved");
    if (status === "BLOCKED") return t("status.blocked");
    return status;
  };

  next();
});

app.use("/public", express.static(path.join(process.cwd(), "src", "public"), { maxAge: "7d" }));
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use("/captcha", captchaRouter);
app.use(authRouter);
app.use(adminRouter);
app.use(portalRouter);

app.use((req, res) => {
  const t = req.t ?? createTranslator(req.locale ?? "ru");
  res.status(404).render("error", {
    title: t("titles.notFound"),
    code: 404,
    message: t("errors.routeNotFound", { path: req.path })
  });
});

app.use((error: Error & { code?: string }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const t = req.t ?? createTranslator(req.locale ?? "ru");
  if (error.code === "EBADCSRFTOKEN") {
    res.status(403).render("error", {
      title: t("titles.csrf"),
      code: 403,
      message: t("errors.invalidCsrf")
    });
    return;
  }

  // eslint-disable-next-line no-console
  console.error(error);
  res.status(500).render("error", {
    title: t("titles.serverError"),
    code: 500,
    message: t("errors.serverError")
  });
});

async function bootstrap(): Promise<void> {
  await ensureSqliteWal();

  const server = app.listen(env.PORT, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`Web server listening on http://127.0.0.1:${env.PORT}`);
  });

  // Upload post-processing (hashing, DB ops) may run for a long time for big files.
  // Nginx is responsible for external timeouts, so disable Node per-request socket timeout.
  server.requestTimeout = 0;
  server.timeout = 0;
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});

