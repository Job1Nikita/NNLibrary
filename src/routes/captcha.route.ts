import { Router } from "express";
import { captchaLimiter } from "../middleware/rate-limit";
import { createCaptchaChallenge } from "../services/captcha.service";

export const captchaRouter = Router();

captchaRouter.get("/challenge", captchaLimiter, (req, res) => {
  const payload = createCaptchaChallenge(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(payload);
});
