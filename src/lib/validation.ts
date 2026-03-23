import { z } from "zod";

const loginPattern = /^[a-zA-Z0-9_.-]+$/;

export const registerSchema = z.object({
  login: z.string().min(3).max(32).regex(loginPattern),
  password: z.string().min(8).max(128),
  challengeId: z.string().min(5).max(64),
  captchaX: z.coerce.number()
});

export const loginSchema = z.object({
  login: z.string().min(3).max(32).regex(loginPattern),
  password: z.string().min(8).max(128),
  challengeId: z.string().min(5).max(64),
  captchaX: z.coerce.number()
});

export const commentSchema = z.object({
  content: z.string().trim().min(1).max(1200)
});

export const directoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[^/\\]+$/)
});

export const directoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[^/\\]+$/)
});

export const fileRegisterSchema = z.object({
  relativePath: z.string().trim().min(1).max(1024),
  directoryId: z.union([z.literal(""), z.coerce.number().int().positive()]).optional(),
  visibleName: z.string().trim().max(255).optional()
});

export const fileUploadSchema = z.object({
  storageSubdir: z.string().trim().max(512).optional(),
  directoryId: z.union([z.literal(""), z.coerce.number().int().positive()]).optional(),
  visibleName: z.string().trim().max(255).optional(),
  overwrite: z.union([z.literal("on"), z.literal("true"), z.literal("")]).optional()
});

export const noticeSchema = z.object({
  text: z.string().trim().min(1).max(500)
});

export const userActionSchema = z.object({
  action: z.enum(["approve", "reject", "ban", "unban"])
});
