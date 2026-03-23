import type { Request, Response } from "express";
import de from "./locales/de.json";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

export const SUPPORTED_LOCALES = ["ru", "en", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type TranslateParams = Record<string, string | number | null | undefined>;
export type TranslateFn = (key: string, params?: TranslateParams) => string;

const DEFAULT_LOCALE: Locale = "ru";
const LOCALE_COOKIE_NAME = "library.lang";

const dictionaries: Record<Locale, unknown> = {
  ru,
  en,
  de
};

function normalizeLocale(raw: string | null | undefined): Locale | null {
  if (!raw) {
    return null;
  }

  const lower = raw.trim().toLowerCase();
  if (!lower) {
    return null;
  }

  const normalized = lower.split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(normalized as Locale) ? (normalized as Locale) : null;
}

function parseCookies(rawCookieHeader: string | undefined): Record<string, string> {
  const raw = rawCookieHeader ?? "";
  if (!raw) {
    return {};
  }

  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const index = pair.indexOf("=");
      if (index <= 0) {
        return acc;
      }
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      try {
        acc[key] = decodeURIComponent(value);
      } catch {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function parseAcceptLanguage(header: string | undefined): Locale | null {
  if (!header) {
    return null;
  }

  const candidates = header
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [langRaw, ...paramsRaw] = part.split(";");
      const qEntry = paramsRaw.map((value) => value.trim()).find((value) => value.startsWith("q="));
      const q = qEntry ? Number.parseFloat(qEntry.slice(2)) : 1;
      return { langRaw, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((item) => item.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate.langRaw);
    if (locale) {
      return locale;
    }
  }

  return null;
}

function pickFirstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string");
    return typeof first === "string" ? first : undefined;
  }

  return undefined;
}

function getByPath(source: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = source;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function interpolate(input: string, params?: TranslateParams): string {
  if (!params) {
    return input;
  }

  return input.replace(/\{\{(\w+)\}\}/g, (_, rawKey: string) => {
    const value = params[rawKey];
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  });
}

export function createTranslator(locale: Locale): TranslateFn {
  return (key, params) => {
    const primary = getByPath(dictionaries[locale], key);
    const fallback = getByPath(dictionaries[DEFAULT_LOCALE], key);
    const value = typeof primary === "string" ? primary : typeof fallback === "string" ? fallback : key;
    return interpolate(value, params);
  };
}

export function resolveRequestLocale(req: Request): Locale {
  const fromQuery = normalizeLocale(pickFirstQueryValue(req.query?.lang));
  if (fromQuery) {
    return fromQuery;
  }

  const cookies = parseCookies(req.headers.cookie);
  const fromCookie = normalizeLocale(cookies[LOCALE_COOKIE_NAME]);
  if (fromCookie) {
    return fromCookie;
  }

  const fromHeader = parseAcceptLanguage(req.get("accept-language"));
  if (fromHeader) {
    return fromHeader;
  }

  return DEFAULT_LOCALE;
}

export function setLocaleCookie(res: Response, locale: Locale, secure: boolean): void {
  res.cookie(LOCALE_COOKIE_NAME, locale, {
    httpOnly: false,
    sameSite: "lax",
    secure,
    maxAge: 1000 * 60 * 60 * 24 * 365
  });
}

export function getLocaleTag(locale: Locale): string {
  if (locale === "ru") return "ru-RU";
  if (locale === "de") return "de-DE";
  return "en-US";
}

export function buildLanguageUrl(req: Request, locale: Locale): string {
  const host = req.get("host") ?? "localhost";
  const protocol = req.protocol || "http";
  const url = new URL(req.originalUrl || req.url, `${protocol}://${host}`);
  url.searchParams.set("lang", locale);
  return `${url.pathname}${url.search}`;
}
