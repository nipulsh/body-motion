# Body Motion – Project Brief

Body Motion is a smart-mirror rehabilitation app. A patient stands in front of a camera, the system analyses their posture, shows which muscles are likely affected on a 3D body model, and then coaches them through AI-generated exercises. A camera tracks the body and counts reps, and the app speaks corrections.

It is made of three parts:

| Part | Folder | Role |
|---|---|---|
| App | `app/` | Kiosk UI (React, optional Electron shell) |
| Vision | `vision/` | Camera, pose, hand, exercise and game logic, shared with the app via the `@vision` alias |
| Server | `server/` | REST API, database, AI analysis pipeline |

---

## 1. Tech stack

**App (`app/`)**
- React 19, TypeScript 5.8, Vite 8
- Tailwind CSS 4, Radix UI primitives, `class-variance-authority`, `lucide-react`
- Three.js for the 3D body and muscle model
- Electron 35 for the kiosk build (`npm run electron:dev` / `electron:start`)
- Browser speech synthesis for voice coaching
- Vitest and jsdom for tests

**Vision (`vision/`)**
- MediaPipe Tasks Vision (pose landmarker and hand landmarker), run in the browser
- Plain TypeScript: rep detection, form checks, gesture logic, game scoring

**Server (`server/`)**
- Node 20+, Express 5, TypeScript
- Prisma 6 on PostgreSQL hosted by Supabase (private storage buckets for patient images, generated images and models)
- Google Gemini via `@google/genai`
    - analysis model for the posture report
    - image model for reference views
    - Veo video model for exercise demo videos
- Meshy for 3D model generation and rigging (optional, `MESHY_ENABLED`)
- Zod for validation, Helmet and CORS, `express-rate-limit`, Multer for uploads
- Vitest for tests

---

## 2. Triggers

### User triggers (what starts things in the app)

| Trigger | Where | Result |
|---|---|---|
| **Fist gesture held ~3 frames** over a button | Mirror UI, any screen | Clicks the button under the hand pointer. Needs an open hand between clicks, plus a 900 ms cooldown. |
| **Pinch** (thumb and index) and drag | Results screen | Rotates or moves the 3D model, or scrolls |
| **Two-hand spread** | Results screen | Zooms the model |
| **Open palm** | Anywhere | Moves the on-screen hand pointer |
| **Analyse** button | Mirror home | Opens camera capture, then uploads images and creates an analysis job |
| **Review analysis** button | Mirror home | Opens the progress page while a job runs, or the results once finished |
| **Exercise** button | Mirror home | Loads the exercise plan and starts a session |
| **Suggested exercises** bar | Results screen | Scrolls down to the AI exercise plan for this analysis (`POST /jobs/:jobId/exercises`, cached per job), shown below the findings with each exercise explained |
| **Start exercise** button | Results screen, suggested exercises | Starts a mirror session on that exercise. Exiting or finishing returns to the results page. |
| **Back to home** | Processing screen | Leaves the progress page. The job keeps running and is polled in the background. |
| **Retry / Home** | Error screen | Retries the failed job, or clears the job and returns home |

### System triggers

| Trigger | Effect |
|---|---|
| Job polling, every 3 s | `GET /api/jobs/:jobId`, then fetch analysis once the job is `COMPLETED`. Stops when the job is `COMPLETED`, `FAILED` or `CANCELLED`. |
| Job reaches `COMPLETED` or `FAILED` | Opens results or the error screen. If the patient is elsewhere, the outcome is kept and shown when they return. |
| Sustained form fault (about 1 s) | Spoken correction |
| Rep completed | Rep count spoken, "rep" flash on screen |
| Set finished | Rest countdown, then the next set or exercise |
| Camera phase starts or stops | Starts or stops the shared hand tracker (`useWireframeHandTracking`). While the exercise tracker is off (rest, transitions), hand navigation uses its own camera. |

---

## 3. App flow (workflow stages)

```
mirror_home → mirror_analysis → mirror_uploading → mirror_processing → mirror_results
     │                                                                      │
     │                                                       mirror_exercise_plan
     ├─────────────────────────────────────────────────────────────────────┤
     └─→ mirror_exercise_session  (also: balance_bird_game, error)
```

State lives in `WorkflowContext` (`app/src/workflow/`). Stages cover capture, upload, processing, results, exercise plan, exercise session, the balance game and the error screen. Older clinical-dashboard stages (`patients`, `scan_detail`, `exercise_*`) also exist in the type.

---

## 4. Methods and API

Base path `/api`. All routes except `/health` need `requireAuth`. Upload routes also have a stricter rate limit.

**Health and hospital**
- `GET /health`
- `GET /hospital/me`

**Patients**
- `POST /patients`
- `GET /patients`
- `GET /patients/:patientId`
- `PATCH /patients/:patientId`
- `DELETE /patients/:patientId`
- `GET /patients/:patientId/scans`
- `GET /patients/:patientId/images`
- `GET /patients/:patientId/models`
- `POST /patients/:patientId/scans`
- `POST /patients/:patientId/jobs`: multipart upload of `images[]` and `angles`, creates an analysis job

**Scans**
- `GET /scans/:scanId`
- `GET /scans/:scanId/analysis`
- `POST /scans/:scanId/process` (alias `/analyze`)
- `GET /scans/:scanId/images`
- `GET /scans/:scanId/models`

**Jobs**
- `GET /jobs/:jobId`: status
- `GET /jobs/:jobId/analysis`
- `GET /jobs/:jobId/generated-images`
- `GET /jobs/:jobId/model`
- `POST /jobs/:jobId/exercises`: generate exercises with Gemini
- `POST /jobs/:jobId/retry`

**Exercises**
- `POST /exercises/demo-video`: generate (or fetch the cached) Veo demo video

### Job pipeline

Statuses: `QUEUED → ANALYZING → GENERATING_IMAGES → CREATING_3D_MODEL → RIGGING → COMPLETED`, or `FAILED`.

Pipeline steps recorded on failure (`failedStep`): `ANALYSIS`, `IMAGE_GENERATION`, `MODEL_GENERATION`, `RIGGING`. With Meshy disabled, the pipeline stops after the reference images.

---

## 5. Responses

### Success shapes
- `JobStatusResponse`: `{ jobId, patientId, status, progress, currentStep, error, createdAt, updatedAt }`
- `AnalysisResponse`: `{ bodyRegion, observedDeformation, affectedSide, summary, muscles[] }`
    - each muscle has `name`, `side`, `likelihood`, `deformation`, `intensity` and `reason`, plus optional `bodyExplorerId` and mesh names for highlighting in 3D
    - `side` is one of `left`, `right`, `bilateral`, `midline`, `unknown`
- `CreateJobResponse`: `{ jobId, status: 'QUEUED' }`
- `GeneratedImageResponseItem[]`: `{ view: front | right | back | left, url }`, signed URLs
- `ModelResponse`: `{ glbUrl, riggedGlbUrl }`
- `GenerateExercisesResponse`: `{ jobId, modelName, exercises[] }`
    - each exercise has `name`, `description`, `targetBodyParts`, `difficulty`, `sets`, `recommendedReps`, `restSeconds`, `instructions`, `safetyNotes`, `trackingRules[]` and `demoVideoUrl`
    - each tracking rule has a joint plus `startAngle`, `requiredAngle`, `minimumAngle`, `maximumAngle`, `tolerance`
- `ExerciseDemoVideoResponse`: `{ exerciseId, demoVideoUrl, cached }`
- List and detail responses are wrapped by name, for example `{ patients }` and `{ patient, jobs }`.

### Error shape (all failures)

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.", "details": [] } }
```

Codes include `VALIDATION_ERROR` (400, Zod issues in `details`) and `NOT_FOUND` (404). Auth, rate-limit, upload and Prisma errors go through the same handler.

### App error handling
`WorkflowError { title, message, technical?, retryStage?, retryKind? }`:
- `retryKind: 'job'` → `POST /jobs/:id/retry`, then back to the processing screen
- `retryKind: 'recapture'` → clear the job and go back to the capture stage

---

## 6. Exercise and vision responses

**Rep phases** (`RepDetector`): `READY → MOVING_TO_TARGET → TARGET_REACHED / HOLDING → RETURNING → REP_COMPLETED`.

**Voice cues** (`exerciseVoiceCoaching`):
- countdown ("Get ready", 3, 2, 1)
- phase cues ("Move toward the target", "Hold", "Return to starting position")
- the running rep count
- "Set complete. Rest for N seconds."
- exercise transitions
- positioning prompts ("Make sure your full body is visible")

**Form checks** exist for squat, lunge and deadlift. Faults include:
- `left_knee_inward`, `right_knee_inward`
- `chest_dropping`
- `trunk_leaning_sideways`
- `hips_uneven`, `shoulders_uneven`

A fault must last about 1 s before it counts. It is then spoken once, and again no sooner than 4 s later. Any two corrections are at least 3 s apart.

**On-screen feedback:** a skeleton and hand wireframe over the video, a form overlay, and a "rep completed" flash.

**Games:** Balance Bird. Pose-based balance detection drives a bird's flight and scoring.
