# Body Motion Server

Standalone Node.js backend for patient management, Gemini muscle/deformation analysis, reference image generation, and Meshy 3D + rigging.

## Prerequisites

- Node.js 20+
- PostgreSQL (Supabase)
- Supabase project with Auth + Storage
- Gemini API key
- Meshy API key
- Reference model image (see `src/assets/README.md`)

## Local setup

```bash
cd server
cp .env.example .env
# Edit .env with real credentials

npm install
npx prisma db push
# Place reference image at src/assets/reference-male-model.png

npm run dev
```

Health check:

```bash
curl http://localhost:3000/api/health
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload (`tsx watch`) |
| `npm run build` | Prisma generate + TypeScript compile |
| `npm start` | Run compiled `dist/server.js` |
| `npm run typecheck` | Type-check without emit |
| `npm run prisma:validate` | Validate Prisma schema |
| `npm run prisma:push` | Push schema to database |

## Environment variables

Copy `.env.example` to `.env`. Everything is validated with Zod at startup — the process exits immediately with a list of problems if anything is missing or malformed.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PORT` | no | `3000` | HTTP listen port |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production`; hides stack traces when `production` |
| `LOG_LEVEL` | no | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DATABASE_URL` | **yes** | — | Supabase Postgres **transaction pooler** URL (port 6543, `?pgbouncer=true`). Must not contain `[YOUR-PASSWORD]`. |
| `DIRECT_URL` | **yes** | — | Supabase Postgres **session/direct** URL (port 5432) for Prisma migrations |
| `SUPABASE_URL` | **yes** | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | **yes** | — | Public key, kept for parity with the desktop client |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | — | Server-only key for JWT verification and Storage admin |
| `SUPABASE_BUCKET_PATIENT_IMAGES` | no | `patient-images` | Private bucket for uploaded originals |
| `SUPABASE_BUCKET_GENERATED_IMAGES` | no | `generated-images` | Private bucket for the four generated views |
| `SUPABASE_BUCKET_MODELS` | no | `models` | Private bucket for mirrored GLB files |
| `SIGNED_URL_TTL_SECONDS` | no | `3600` | Lifetime of every signed read URL (60–604800) |
| `GEMINI_API_KEY` | **yes** | — | Gemini API key |
| `GEMINI_ANALYSIS_MODEL` | no | `gemini-3.6-flash` | Multimodal analysis model |
| `GEMINI_IMAGE_MODEL` | no | `gemini-2.5-flash-image` | Nano Banana image-generation model |
| `GEMINI_UPLOAD_MODE` | no | `auto` | `auto` \| `inline` \| `files`; how patient images reach Gemini |
| `GEMINI_INLINE_BUDGET_BYTES` | no | `14000000` | Raw-byte budget above which `auto` switches to the Files API |
| `GEMINI_FILE_ACTIVE_TIMEOUT_MS` | no | `180000` | Max wait for an uploaded file to reach `ACTIVE` |
| `MESHY_API_KEY` | **yes** | — | Meshy API key (`msy_…`) |
| `MESHY_API_BASE_URL` | no | `https://api.meshy.ai` | Meshy origin |
| `MESHY_POLL_INTERVAL_MS` | no | `5000` | Delay between task polls |
| `MESHY_MAX_POLL_ATTEMPTS` | no | `120` | Poll attempts before the stage times out |
| `MESHY_TARGET_POLYCOUNT` | no | `30000` | Remesh target; must stay ≤300k or rigging rejects the model |
| `MESHY_RIG_HEIGHT_METERS` | no | `1.7` | `height_meters` sent to the rigging endpoint |
| `REFERENCE_MODEL_IMAGE_PATH` | no | `src/assets/reference-male-model.png` | Common male reference image (see `src/assets/README.md`) |
| `CORS_ORIGIN` | no | *(empty)* | Comma-separated origins, or `*`; empty blocks all cross-origin requests |
| `RATE_LIMIT_WINDOW_MS` | no | `900000` | Global rate-limit window |
| `RATE_LIMIT_MAX` | no | `300` | Requests per window per IP |
| `UPLOAD_RATE_LIMIT_MAX` | no | `20` | Job-creation requests per window per IP |
| `TRUST_PROXY` | no | `false` | Set `true` behind Render's proxy so rate limiting sees real client IPs |

## Supabase Storage

Create **private** buckets:

- `patient-images`
- `generated-images`
- `models`

The service role key is used server-side only for uploads, signed URLs, and deletes.

## Render deployment

1. Create a **Web Service** connected to this repo (`server` root directory).
2. **Build command:** `npm install && npm run build`
3. **Start command:** `npm start`
4. Set all variables from `.env.example` in the Render dashboard.
5. Set `NODE_ENV=production`, `TRUST_PROXY=true`, and a production `CORS_ORIGIN`.
6. Run `npx prisma db push` once against the production database (or add a release command).
7. Upload the reference model image to the instance filesystem or mount it and set `REFERENCE_MODEL_IMAGE_PATH`.

Recommended Render settings:

- Instance: at least 1 GB RAM (image upload + AI pipeline)
- Health check path: `/api/health`

## API overview

All protected routes require `Authorization: Bearer <supabase_access_token>`.

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/health` | No (`database` field reports Postgres; `models` lists the active Gemini analysis and image-generation IDs) |
| POST | `/api/test-upload` | Yes (development only; one `image` file) |
| POST | `/api/patients` | Yes |
| GET | `/api/patients` | Yes |
| GET | `/api/patients/:patientId` | Yes |
| DELETE | `/api/patients/:patientId` | Yes |
| POST | `/api/patients/:patientId/jobs` | Yes |
| GET | `/api/jobs/:jobId` | Yes |
| GET | `/api/jobs/:jobId/analysis` | Yes |
| GET | `/api/jobs/:jobId/generated-images` | Yes |
| GET | `/api/jobs/:jobId/model` | Yes |
| GET | `/api/patients/:patientId/images` | Yes |
| POST | `/api/jobs/:jobId/retry` | Yes |

## Job lifecycle

```
QUEUED → ANALYZING → GENERATING_IMAGES → CREATING_3D_MODEL → RIGGING → COMPLETED
                                                                    ↘ FAILED
```

Progress: `ANALYSIS` 5→25, `IMAGE_GENERATION` 25→50, `MODEL_GENERATION` 50→80, `RIGGING` 80→99, `COMPLETED` 100.

Manual retry (`POST /api/jobs/:jobId/retry`) resumes from the first incomplete step, derived from what is already persisted rather than from `failedStep`. There are no automatic retries anywhere in the pipeline.

## Meshy wiring notes

- Only the four generated reference images are sent to Meshy, as base64 data URIs with the **front** view first (Meshy treats element 0 as the primary view). The 30–40 patient originals never leave Supabase.
- `should_texture` stays `true`: Meshy auto-rigging rejects untextured meshes.
- Rigging is driven from `model_url`, not `input_task_id`. Meshy documents `input_task_id` only for its own Text/Image-to-3D tasks and never confirms that a multi-image-to-3d task qualifies.
- Meshy asset URLs expire 3 days after `finished_at`, so both GLBs are mirrored into the private `models` bucket immediately on success. `GET /api/jobs/:jobId/model` always returns signed URLs to those mirrored copies, and rigging reads its input from the mirror so a retry works long after Meshy's URL has died.

## External API docs (verified)

- Gemini models: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
- Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Meshy multi-image-to-3d: https://docs.meshy.ai/en/api/multi-image-to-3d
- Meshy rigging: https://docs.meshy.ai/en/api/rigging
