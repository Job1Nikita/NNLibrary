# GitHub Publish Guide (First Time)

This guide is tailored for this project (`/opt/Library`).

## 1) Prepare repository safely

Before first push, make sure these are **NOT** committed:

- `.env`
- `prisma/*.db`
- `logs/`
- `tmp/`
- any real tokens/passwords/domains used in production

Current repo already has:

- `.gitignore` configured for runtime/secrets artifacts
- `.env.example` for public configuration template
- `.gitattributes` to keep consistent LF line endings

## 2) Rotate production secrets

If secrets were ever stored in code/files/screenshots, rotate them:

- `BOT_TOKEN`
- `SESSION_SECRET`
- `HMAC_SECRET`
- `ADMIN_PASSWORD`

Also verify no real secret values remain in:

- `README.md`
- `ecosystem.config.cjs`
- `nginx/*.sample`
- screenshots/docs

## 3) Initialize git locally

Run in project root:

```bash
cd /opt/Library
git init
git branch -M main
```

## 4) Check exactly what will be published

```bash
git status
git add .
git status
```

Inspect staged diff carefully:

```bash
git diff --cached
```

If something sensitive appears, unstage it:

```bash
git restore --staged <path>
```

## 5) First commit

```bash
git commit -m "Initial public release: library archive portal"
```

If git asks for identity:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## 6) Create GitHub repo and push

1. Create empty repo on GitHub (no README/license from UI).
2. Connect remote and push:

```bash
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

## 7) Recommended post-publish settings

In GitHub repo settings:

- enable branch protection for `main`
- enable Dependabot security updates
- enable secret scanning (if available)

## 8) Daily workflow (update project safely)

```bash
git status
git add <changed-files>
git commit -m "Describe your change"
git push
```

## 9) Rollback to previous version

View history:

```bash
git log --oneline --decorate --graph -n 20
```

Rollback in a safe/public way (without history rewrite):

```bash
git revert <commit_hash>
git push
```

## 10) Before every release

Quick checklist:

- `npm run build` succeeds
- app starts and key pages work (`/login`, `/`, `/file/:id`, `/admin`)
- no secrets in staged diff
- `README.md` reflects current setup
