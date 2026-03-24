# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [1.0.0] - 2026-03-24

### Added
- Initial public release of SSR archive portal (Express + EJS + TypeScript).
- User registration/login with approval workflow (`PENDING/APPROVED/BLOCKED`).
- Slider captcha for login and registration.
- Telegram admin bot (long polling) with moderation and statistics.
- Directory listing UI, file page, comments, protected downloads via `X-Accel-Redirect`.
- Admin panel for user moderation, notice publishing, directory and file management.
- File upload from portal to storage root and DB registration with checksums.
- Russian/English/German interface localization.
- Security baseline: Helmet, session hardening, CSRF, validation, rate limits, audit logs.

### Infrastructure
- PM2 ecosystem config for web and bot processes.
- Nginx sample config with internal protected location for downloads.
- Prisma migrations and seed/admin scripts.
