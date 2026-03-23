import type { User } from "@prisma/client";
import type { Locale, TranslateFn } from "../src/i18n";

declare global {
  namespace Express {
    interface Request {
      currentUser?: User | null;
      locale?: Locale;
      t?: TranslateFn;
    }
  }
}

export {};
