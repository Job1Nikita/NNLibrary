import rateLimit from "express-rate-limit";

function createLocalizedLimiter(options: {
  windowMs: number;
  max: number;
  messageKey: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next, handlerOptions) => {
      const t = req.t ?? ((key: string) => key);
      res.status(handlerOptions.statusCode).send(t(options.messageKey));
    }
  });
}

export const authLimiter = createLocalizedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  messageKey: "errors.rateLimitAuth"
});

export const captchaLimiter = createLocalizedLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  messageKey: "errors.rateLimitCaptcha"
});

export const downloadLimiter = createLocalizedLimiter({
  windowMs: 60 * 1000,
  max: 30,
  messageKey: "errors.rateLimitDownload"
});

export const uploadLimiter = createLocalizedLimiter({
  windowMs: 60 * 60 * 1000,
  max: 25,
  messageKey: "errors.rateLimitUpload"
});
