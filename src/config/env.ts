import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(24),
  BOT_TOKEN: z.string().optional().default(""),
  ADMIN_CHAT_ID: z.string().optional().default(""),
  HMAC_SECRET: z.string().min(24),
  STORAGE_ROOT: z.string().min(1),
  BASE_URL: z.string().url(),
  ADMIN_LOGIN: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  ADMIN_PASSWORD: z.string().min(8),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(10240),
  ADMIN_ALLOWED_IPS: z.string().default("127.0.0.1"),
  AV_SCAN_MODE: z.enum(["off", "optional", "required"]).default("off"),
  AV_COMMAND: z.string().min(1).default("clamscan"),
  AV_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000)
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${details}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

