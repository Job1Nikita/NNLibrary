# NNLibrary v1.0.0

Initial public release of **NNLibrary** - a production-oriented SSR archive portal with classic directory listing style.

## Highlights

- Server-rendered architecture (Express + EJS + TypeScript) without SPA complexity.
- Registration and login with admin approval flow and slider captcha.
- Telegram admin bot (long polling) for moderation, stats, and site notices.
- Protected file downloads through backend auth checks + nginx `X-Accel-Redirect`.
- Admin tooling for managing users, directories, and files.
- UI localization: Russian, English, German.
- Security baseline: CSRF, rate limits, secure sessions, validation, audit logs.

## Operational notes

- Recommended runtime: Ubuntu 24.04 + nginx + PM2.
- Storage served through internal nginx location only.
- Prisma + SQLite (WAL) for fast MVP deployment.

## Upgrade / install

Please follow the setup instructions in `README.md`.
