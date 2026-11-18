# Body Motion — Getting Started

Step-by-step guide to install and run Body Motion on a development machine.

> `app/README.md` and `app/BODY_MOTION.md` are out of date. They describe a Tauri shell and Supabase magic-link sign-in. The app now runs in **Electron** (or a plain browser), and the server uses a **local dev user**, so there is no sign-in.

The project has three parts:

| Folder | What it is | Runs on |
|---|---|---|
| `server/` | REST API: Express 5, Prisma, Gemini pipeline | `http://localhost:3000` by default (`PORT`) |
| `app/` | Kiosk UI: React 19, Vite, Three.js, Electron shell | `http://localhost:1420` (fixed) |
| `vision/` | Camera, pose, exercise and game logic | No install. The app imports it through the `@vision` alias and uses `app/node_modules` |

`spinepose/`, `Squat-AI/` and `deadlift-visual-analyzer/` are reference Python repos. They are **not needed** to run the app. A fresh clone shows them as empty folders.

---

## Step 1 — Install the prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 20 or newer (tested on 24.15) | `node -v` |
| npm | Comes with Node (tested on 11.12) | `npm -v` |
| Git | Any recent | `git --version` |
| Webcam | Needed for analysis, exercises and games | |
| Internet | Needed at runtime: MediaPipe and SpinePose models load from CDNs, and analysis calls Gemini | |

You also need these accounts or keys:

- **Supabase project.** Used for its **PostgreSQL** database. The Supabase URL and keys are also required at startup, even though files are stored locally by default.
- **Google Gemini API key.** Used for posture analysis, reference images and Veo demo videos.
- **Meshy API key.** Optional, for 3D model generation and rigging. Leave it disabled if you don't have one.

Python is **not** required. It is only used by the one-off asset scripts in `app/raw_models/`.

---

## Step 2 — Get the code

```bash
git clone <repo-url> bpsy-motion
cd bpsy-motion
```

---

## Step 3 — Install the dependencies

Install the server and the app separately. There is no root `package.json`.

```bash
# Server (also runs `prisma generate` automatically)
cd server
npm install

# App (vision uses the app's node_modules)
cd ../app
npm install
```

Notes:
- `app/.npmrc` sets `legacy-peer-deps=true`, so peer-dependency warnings in the app are expected.
- Electron (about 100 MB) downloads during the app install.
- **Windows:** if the server install ends with `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`, the server is still running and holds the Prisma engine open. The packages are installed; only `prisma generate` failed. Stop the server, then run `npx prisma generate` in `server/`.

---

## Step 4 — Configure the server (`server/.env`)

```bash
cd server
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

Edit `server/.env` and fill in the **required** values:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Transaction pooler** (port 6543, keep `?pgbouncer=true`) |
| `DIRECT_URL` | Same page → **Session pooler** or direct connection (port 5432) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → API keys → anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API keys → service_role / secret key. Server only, never put it in the app. |
| `GEMINI_API_KEY` | Google AI Studio → API keys |

Then check these:

- `PORT`: the API port. The default is `3000`. Any free port works, as long as it matches `VITE_API_URL` in Step 5.
- `CORS_ORIGIN=http://localhost:1420`: must allow the app's origin.
- `STORAGE_DRIVER=local` (default): uploads and generated files go to `server/storage/`, so no Supabase buckets are needed. Set it to `supabase` only if you have created the private buckets `patient-images`, `generated-images` and `models`.
- `MESHY_ENABLED=false` (default): the pipeline stops after the reference images. To turn it on, set `MESHY_ENABLED=true` and `MESHY_API_KEY`.

The server validates `.env` at startup. If anything is missing or still a placeholder (for example `[YOUR-PASSWORD]`), it exits and lists each problem.

---

## Step 5 — Configure the app (`app/.env`)

```bash
cd ../app
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

```ini
# Must point at the server's PORT from Step 4. No trailing slash.
VITE_API_URL=http://localhost:3000

# Optional, development only:
# VITE_VISION_DEBUG_ROTATION=true     # rotation overlay and logs
# VITE_EXERCISE_DIAGNOSTIC=true       # exercise diagnostics and calibration recording
```

Vite reads `.env` only when it starts, so restart the app after you change this file.

---

## Step 6 — Create the database tables

Run this once against a new database:

```bash
cd server
npx prisma db push
```

Use `db push`, **not** `prisma migrate deploy` or `npm run start:deploy`, on a fresh database. The migrations in `prisma/migrations/` assume the base tables already exist, so on an empty database they fail.

Optional: browse the data with `npm run prisma:studio`.

---

## Step 7 — Add the reference model image (optional for first start)

The image-generation step needs a full-body, neutral **male reference image** that is not a patient photo. It is gitignored, so every machine supplies its own:

```
server/src/assets/reference-male-model.png     (PNG, JPEG or WEBP, about 1024×1024 or larger)
```

The server starts without it. Only analysis jobs fail, at the `IMAGE_GENERATION` step. Add the file and use **Retry** on the job. See `server/src/assets/README.md`.

---

## Step 8 — Start the server

Terminal 1:

```bash
cd server
npm run dev
```

Check that it is up (use your `PORT`):

```bash
curl http://localhost:3000/api/health
```

Expected:

```json
{"status":"ok","database":"ok","models":{"analysis":"gemini-3.6-flash","imageGeneration":"gemini-2.5-flash-image"}, ...}
```

If `database` is not `ok`, check `DATABASE_URL` and `DIRECT_URL`.

---

## Step 9 — Start the app

Pick **one** of these. Both use port **1420**, and Vite will not start if 1420 is already taken.

### Option A — Electron kiosk (the real setup)

Terminal 2:

```bash
cd app
npm run electron:dev
```

This starts Vite on `http://localhost:1420`, waits for it, then opens Electron. Electron gives the camera only to `localhost:1420`. It also opens a frameless, full-screen **Smart Mirror** window on the display you pick.

### Option B — Browser only (quicker for UI work)

Terminal 2:

```bash
cd app
npm run dev
```

Open `http://localhost:1420` in Chrome or Edge and allow camera access.

### First run

- There is no login. The server uses a local dev user and creates its hospital profile automatically.
- If the app stays on **"Loading hospital profile..."**, it cannot reach the server. Check Step 8, check that `VITE_API_URL` matches `PORT`, and check that `CORS_ORIGIN` includes `http://localhost:1420`.
- The screens are laid out for a **portrait** mirror. On a landscape monitor the stage appears rotated.

---

## Step 10 — Run the tests (optional)

```bash
cd app
npm test          # app tests and all vision/ tests

cd ../server
npm test
```

At the time of writing (2026-11-18), some tests fail on `main` before any changes: 21 in app/vision and 9 in the server. They cover recently changed behaviour such as squat angle conventions, the home-screen menu, the Exit button position and the analysis pipeline fixtures. They are not install problems.

---

## Step 11 — Production build

```bash
# App: type-check, build to app/dist, then launch Electron on the build
cd app
npm run electron:start

# Server: prisma generate, compile to server/dist, then run
cd server
npm run build
npm start
```

For deploying the server to Render, see `server/README.md` → *Render deployment*. Set `NODE_ENV=production`, `TRUST_PROXY=true` and a real `CORS_ORIGIN`.

---

## Quick reference

| Task | Command (from the folder shown) |
|---|---|
| Install | `server/`: `npm install` · `app/`: `npm install` |
| API dev server | `server/`: `npm run dev` |
| Kiosk (Electron + Vite) | `app/`: `npm run electron:dev` |
| Browser only | `app/`: `npm run dev` → http://localhost:1420 |
| Health check | `curl http://localhost:<PORT>/api/health` |
| Create DB tables | `server/`: `npx prisma db push` |
| Regenerate Prisma client | `server/`: `npx prisma generate` (stop the server first on Windows) |
| Tests | `app/`: `npm test` · `server/`: `npm test` |
| Server type-check | `server/`: `npm run typecheck` |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server exits with `Invalid environment configuration` | It lists the missing or invalid variables. Fix them in `server/.env`. |
| `... still contains a placeholder password` | Replace `[YOUR-PASSWORD]` in `DATABASE_URL` and `DIRECT_URL`. |
| `Port 1420 is already in use` | Another Vite or `electron:dev` is already running. Use that one or stop it. |
| App stuck on "Loading hospital profile..." | Server not running, `VITE_API_URL` wrong, or `CORS_ORIGIN` missing `http://localhost:1420`. Restart Vite after changing `.env`. |
| `EPERM ... query_engine-windows.dll.node` | Stop the server, then run `npx prisma generate`. |
| Camera or pose never starts | Allow camera access. Make sure you are online, because the models load from jsDelivr, Google Storage and Hugging Face. In Electron, the app must be on `localhost:1420`. |
| Job fails at `IMAGE_GENERATION` | Add `server/src/assets/reference-male-model.png` (Step 7), then retry. |
| Pipeline stops after the reference images | Expected while `MESHY_ENABLED=false`. |
