# FileVault — self-hosted S3-like file storage

A complete, self-hosted file storage app: create **sets** (buckets), upload files with
**multer** to local disk, mark files **public** for keyless URLs, or keep them **private**
and download them through the API with an **API key**. Includes a one-time **super admin**
bootstrap, user management, share links, quotas, stats and a SvelteKit dashboard.

Built with **SvelteKit for both the frontend and the backend** — every page, API endpoint
and public file URL lives under `src/routes`.

## Features

- **First-run setup** — when no users exist, `/setup` creates the one and only super admin.
  Afterwards the setup endpoint is locked and **only the super admin can create users**.
- **Sets (buckets)** — users can create multiple sets; the super admin sees and manages all.
- **Local uploads with multer** — streamed multipart uploads, multiple files per request,
  size/count limits, random on-disk names, original filenames preserved as metadata.
- **Private by default** — private files need the owner's session, a Bearer token or an API key.
- **Public files** — one toggle switches a file (or a whole set's default) to public; the clean
  URL `/s/<set-slug>/<file-slug>` then works without any key.
- **API keys** — create/revoke per user, hashed at rest, shown only once, `x-api-key` header or
  `?api_key=` query param, last-used tracking.
- **Share links** — tokenized `/share/<token>` links for private files, with optional expiry and
  revocation; only a hash of the token is stored.
- **Users & quotas** — super admin creates users, resets passwords, edits names/quotas (MB),
  and deletes users (their sets are transferred to the super admin, keys are revoked).
- **Dashboard** — drag-and-drop upload, search, pagination, public/private toggle, rename,
  download, copy public link, share modal, storage meter, API key manager, user manager.
- **File API** — download with `Content-Disposition`, inline previews for images/PDF/video/audio/
  text, HTTP Range support, download counters.
- **Security basics** — bcrypt passwords, httpOnly JWT cookie, hashed API keys/share tokens,
  login/setup rate limiting, upload limits, sanitized storage paths, no direct access to `uploads/`.

## Tech stack

- **SvelteKit 2** (Svelte 5) with `@sveltejs/adapter-node`
- **multer** (disk storage) for uploads
- **Local JSON store** (`data/db.json`, atomic writes) — zero external services
- Node.js built-ins (`crypto`, `fs`, streams), `jsonwebtoken`, `bcryptjs`, `mime-types`

> The JSON store keeps the project instantly runnable. `src/lib/server/db.js` is a small
> isolate; swap it for MongoDB/Postgres without touching the routes.

## Quick start

Requires **Node.js 20+**.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. On first run you are redirected to `/setup`:

1. Create the super admin (name, username, password).
2. You are signed in and land on the dashboard.
3. Create a set, upload a file, and toggle it public or keep it private.
4. Create users under **Users** (super admin only).

Optionally copy `.env.example` to `.env` first (the app runs with sensible defaults without it).

### Production

```bash
npm run build
npm start
```

`npm start` runs `scripts/start.mjs`, which loads `.env`, raises adapter-node's
`BODY_SIZE_LIMIT` to fit your upload settings, and boots the server on `PORT`.

Set a strong `JWT_SECRET` in production. If omitted, one is generated and stored in
`data/.jwt-secret` (sessions survive restarts, but env is preferable).

## How access works

| What | URL | Credentials |
| --- | --- | --- |
| Public file | `/s/<set-slug>/<file-slug>` | none |
| Public file, force download | `/s/<set-slug>/<file-slug>?download=1` | none |
| Private file (API) | `/api/files/<file-id>/download` | `Authorization: Bearer <jwt>` or `x-api-key` |
| Private file (query key) | `/api/files/<file-id>/download?api_key=fv_...` | API key |
| Share link | `/share/<token>` | token in URL (works for private files) |
| File metadata | `/api/files/<file-id>` | public files: none; private: owner/token/key |
| Dashboard | `/app` | session cookie |

A user's API key grants access to that user's private files. The super admin's key/JWT
can access every file.

## API overview

All JSON endpoints are under `/api`. Authenticate with a session cookie (dashboard),
`Authorization: Bearer <jwt>`, or an API key.

### Public / bootstrap

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/status` | `{ setupRequired, appName }` |
| GET | `/api/health` | health check |
| POST | `/api/setup` | create the first super admin (only while no users exist) |
| POST | `/api/auth/login` | login, sets session cookie, returns `{ token, user }` |
| POST | `/api/auth/logout` | clear session cookie |
| GET | `/api/auth/me` | current user + usage |
| POST | `/api/auth/change-password` | change own password |

### Users (super admin only)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/users` | list users with usage |
| POST | `/api/users` | create user `{ name, username, password, quotaMB }` |
| GET | `/api/users/:id` | get one user |
| PATCH | `/api/users/:id` | update `{ name?, quotaMB?, password? }` (`quotaMB: null` = unlimited) |
| DELETE | `/api/users/:id` | delete user (sets transferred to you, keys revoked) |

### Sets

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/sets` | own sets (super admin: `?all=1`, `?owner=<id>`) |
| POST | `/api/sets` | create `{ name, description?, isPublic? }` |
| GET | `/api/sets/:id` | set details + stats (id or slug) |
| PATCH | `/api/sets/:id` | update name/description/default visibility |
| DELETE | `/api/sets/:id` | delete set, its files and shares |

### Files

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/sets/:id/files` | list/search files (`?q=&page=&limit=`) |
| POST | `/api/sets/:id/files` | upload multipart field `files` (repeatable), optional `isPublic` |
| GET | `/api/files/:id` | file metadata + URLs |
| PATCH | `/api/files/:id` | `{ name?, isPublic? }` |
| DELETE | `/api/files/:id` | delete file + its share links |
| GET | `/api/files/:id/download` | stream file (`?download=1`, supports Range) |
| GET | `/api/files/:id/shares` | list share links |
| POST | `/api/files/:id/shares` | create share `{ expiresInDays? }` |
| DELETE | `/api/shares/:id` | revoke share link |
| GET | `/api/keys` | own API keys (super admin: `?all=1`) |
| POST | `/api/keys` | create key `{ name }` (plain key returned once) |
| DELETE | `/api/keys/:id` | revoke key |
| GET | `/api/stats` | own usage, or instance totals for the super admin |

### curl examples

```bash
# 1. First-run setup (returns a JWT)
curl -X POST http://localhost:3000/api/setup \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","username":"admin","password":"change-me-123"}'

# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"change-me-123"}'

# 3. Create a set (use the returned token)
curl -X POST http://localhost:3000/api/sets \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Invoices","isPublic":false}'

# 4. Upload files (multipart, field "files", repeat for multiple files)
curl -X POST http://localhost:3000/api/sets/<SET_ID>/files \
  -H "Authorization: Bearer <TOKEN>" \
  -F "files=@invoice.pdf" \
  -F "isPublic=false"

# 5. Create an API key (shown once)
curl -X POST http://localhost:3000/api/keys \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"automation"}'

# 6. Download a private file with the key
curl -OJ "http://localhost:3000/api/files/<FILE_ID>/download?api_key=fv_..."

# 7. Make a file public, then use its keyless URL
curl -X PATCH http://localhost:3000/api/files/<FILE_ID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"isPublic":true}'
# -> GET http://localhost:3000/s/<set-slug>/<file-slug>

# 8. Create a share link for a private file (expires in 7 days)
curl -X POST http://localhost:3000/api/files/<FILE_ID>/shares \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"expiresInDays":7}'
```

## Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | dev and production server port |
| `APP_NAME` | `FileVault` | name in the UI |
| `JWT_SECRET` | generated in `data/.jwt-secret` | JWT signing secret — set in production |
| `JWT_TTL` | `7d` | JWT lifetime |
| `MAX_UPLOAD_MB` | `100` | max size per file |
| `MAX_FILES_PER_UPLOAD` | `10` | max files per request |
| `DEFAULT_QUOTA_MB` | `1024` | default quota for new users |
| `DATA_DIR` | `./data` | metadata + JWT secret location |
| `UPLOAD_DIR` | `./uploads` | stored file location |
| `CORS_ORIGIN` | `*` | CORS origin for the API |

## Storage & backups

- `data/db.json` — users, sets, file metadata, API key hashes, share token hashes.
- `data/.jwt-secret` — generated signing secret when `JWT_SECRET` is absent.
- `uploads/<set-id>/<timestamp-random>.<ext>` — actual file bytes.

Back up **both** `data/` and `uploads/`. They are git-ignored. This is a single-process,
single-instance design; for horizontal scaling, move metadata to a shared database and files
to shared/object storage.

## Security notes

- Passwords are hashed with bcrypt; JWTs live in an httpOnly, SameSite=Lax cookie.
- API keys and share tokens are stored only as SHA-256 hashes.
- Private files are not exposed by static middleware at all; downloads go through authorization.
- Public URLs return 404 for private files (no existence leak).
- Login and setup endpoints are rate limited; upload size/count is limited; on-disk names are
  generated server-side.
- HTML, SVG and other scriptable/active file types are always served with
  `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, so uploaded content
  can never execute scripts on the app's origin.
- Run behind HTTPS in production and set a long random `JWT_SECRET`.
- No antivirus scanning — only let trusted users upload, and treat public files as public.

## Project structure

```
src/
  app.css                  global theme + shared UI styles
  app.html                 SvelteKit shell
  hooks.server.js          CORS for /api + security headers
  lib/
    format.js              client-safe byte/date formatting
    components/            AuthCard, Modal
    server/
      auth.js              JWT/cookie/API-key authentication
      config.js            env configuration
      db.js                atomic JSON persistence
      http.js              JSON responses + ApiError wrapper
      ratelimit.js         in-memory rate limiter
      serve.js             streaming downloads + Range support
      store.js             users/sets/files/keys/shares business logic
      upload.js            multer <-> Web Request bridge
      utils.js
  routes/
    +page.server.js        smart redirect (setup / login / app)
    setup/ login/ app/     frontend pages
    api/...                JSON API endpoints
    s/[setSlug]/[fileSlug] public file URLs
    share/[token]          share-link file URLs

scripts/                   (project root, not inside src/)
  start.mjs                production launcher (loads .env, sets body limit)
  smoke-test.mjs           end-to-end API test
```

## Testing

```bash
npm test
```

The smoke test starts an isolated server with temporary `data`/`uploads` folders and verifies
setup locking, auth, page redirects, user creation rules, sets, multer uploads, private/public
access, API keys, share links, quotas, range/HEAD requests, rename/delete, user data transfers,
stats and CORS (75 assertions). Your real data is untouched.

To test the production build instead of the dev server:

```bash
npm run build
SMOKE_TARGET=build npm test
```

(On Windows PowerShell, use `$env:SMOKE_TARGET="build"; npm test`.)

## Notes

- The original untouched `sv create` SvelteKit scaffold was backed up to `_scaffold-backup/`
  when this project was rebuilt; you can delete that folder.
- No database server is required. To swap in a real database, replace `src/lib/server/db.js`
  and keep the `store.js` API surface.
