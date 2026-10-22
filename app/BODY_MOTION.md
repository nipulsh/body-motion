# Body Motion Desktop App

Tauri + React + TypeScript client for guided 360° capture, upload, and clinical movement analysis.

## Prerequisites

- Node.js 20+
- Rust toolchain (for Tauri)
- Backend API running (`../server`) with Supabase auth configured
- Anatomy GLB assets in `raw_models/` (`anatomy.glb`, `skeleton.glb`, `mesh_mapping.json`)

## Environment

Copy `.env.example` to `.env` in this folder:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend base URL (e.g. `http://localhost:3000`) |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |

## Install & build

```bash
npm install
npm run build
```

## Run (development)

Start the API server first, then:

```bash
npm run tauri dev
```

This runs Vite on port `1420` and opens the Tauri window.

Web-only (no Tauri shell):

```bash
npm run dev
```

## Auth

Sign in with **email magic link** (Supabase OTP). The access token is sent as `Authorization: Bearer <token>` on all `/api/*` requests.

## Scanning flow

1. **Camera setup** — `getUserMedia`, optional device picker, silhouette guide.
2. **360° scan** — `scanCaptureService` uses **MediaPipe Pose Landmarker** locally (browser only; nothing sent to the backend except captured JPEGs).
3. Captures ~36 frames at ~10° yaw buckets; dedupes same angle; minimum 30 images before upload.
4. **Upload** — multipart `images[]` to `POST /api/patients/:patientId/jobs` with XHR progress.
5. **Processing** — poll `GET /api/jobs/:jobId` until `COMPLETED` or `FAILED`.
6. **Results** — BodyExplorer highlights from `bodyExplorerMeshNames`; rigged GLB from `GET /api/jobs/:jobId/model`.

## BodyExplorer

Legacy loaders live in `src/bodyExplorer/bodyBuilder.js` and `muscleData.js`. React viewer: `BodyExplorerViewer.tsx`. Highlights: `highlights.ts` matches underscore mesh IDs from analysis.

Server muscle map reference: `public/muscleMap.json` (copy of `server/src/config/muscleMap.json`).

## Future rig control

Placeholder: `src/rig/futureRigControl.ts` for Python → localhost → Tauri → Three.js (not implemented).
