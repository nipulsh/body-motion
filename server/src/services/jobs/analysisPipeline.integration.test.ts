/**
 * Integration: scan posture metrics → analysis pipeline → Gemini (mocked) → saved findings.
 * Real modules: jobPipeline, analysisFrameSelection, analysis.service (prompt, wrong-region
 * guard, contribution normalisation), muscleMap lookups, posture schema.
 * Mocked: database repositories, object storage, the Gemini HTTP client.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  job: null as unknown,
  saved: [] as unknown[],
  failures: [] as string[],
  allowFailure: false,
}));

const gemini = vi.hoisted(() => ({
  responses: [] as unknown[],
  prompts: [] as string[],
}));

vi.mock('../../repositories/job.repository', () => ({
  findJobWithRelations: vi.fn(async () => db.job),
  findJobById: vi.fn(async () => db.job),
  listJobImages: vi.fn(async () =>
    Array.from({ length: 3 }, (_, i) => ({
      bucket: 'b',
      storagePath: `p/${i}.jpg`,
      mimeType: 'image/jpeg',
      angle: String(i * 10),
      orderIndex: i,
    })),
  ),
  markJobStarted: vi.fn(async () => undefined),
  markJobCompleted: vi.fn(async () => undefined),
  markJobFailed: vi.fn(async (_id: string, _step: string, message: string) => {
    if (!db.allowFailure) throw new Error(`job failed unexpectedly: ${message}`);
    db.failures.push(message);
  }),
  saveAnalysisResult: vi.fn(async (input: unknown) => {
    db.saved.push(input);
    return input;
  }),
  updateJobProgress: vi.fn(async () => undefined),
  upsertGeneratedImage: vi.fn(),
  upsertMeshyJob: vi.fn(),
}));
vi.mock('../../repositories/scan.repository', () => ({ upsertScanPatientModel: vi.fn() }));
vi.mock('../scans/scanProcess.service', () => ({ syncScanStatusForJob: vi.fn(async () => undefined) }));
vi.mock('../storage/storage.service', () => ({
  downloadObject: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff])),
  uploadObject: vi.fn(),
  createSignedUrl: vi.fn(),
}));
vi.mock('../../config/pipelineSteps', () => ({ pipelineStepsForJob: () => ['ANALYSIS'] }));
vi.mock('../gemini/gemini.client', () => ({
  getGeminiClient: () => ({
    models: {
      generateContent: vi.fn(async (request: { contents: { parts: Array<{ text?: string }> } }) => {
        gemini.prompts.push(request.contents.parts[0]?.text ?? '');
        const next = gemini.responses.shift();
        if (!next) throw new Error('unexpected extra Gemini call');
        return { text: JSON.stringify(next), candidates: [], usageMetadata: {} };
      }),
    },
  }),
}));

import { processAnalysisJob } from './jobPipeline.service';
import { postureMetricsSchema, type PostureMetrics } from '../../schemas/posture.schema';

const REGIONS = [
  'head_neck', 'shoulder', 'upper_arm_elbow', 'forearm_hand', 'chest', 'upper_back', 'lower_back',
  'abdomen', 'pelvis_hip', 'thigh', 'knee', 'lower_leg_ankle', 'foot',
] as const;

function assessment(primary: (typeof REGIONS)[number]) {
  return REGIONS.map((region) => ({
    region,
    side: region === primary ? 'left' : 'unknown',
    severity: region === primary ? 0.8 : 0,
    observation: region === primary ? 'deviation seen' : 'no notable deviation',
  }));
}

function muscle(name: string, region: string, contributionPercent: number) {
  return {
    name,
    side: 'left',
    likelihood: 0.7,
    deformation: 'shortened',
    intensity: 0.6,
    reason: 'cites measurement',
    region,
    contributionPercent,
  };
}

const shoulderOnlyAnswer = {
  regionAssessment: assessment('shoulder'),
  bodyRegion: 'shoulder',
  observedDeformation: 'Left shoulder depressed',
  affectedSide: 'left',
  summary: 'Shoulder asymmetry',
  muscles: [muscle('Left Deltoid', 'shoulder', 60), muscle('Left Trapezius', 'shoulder', 40)],
};

const kneeAnswer = {
  regionAssessment: assessment('knee'),
  bodyRegion: 'knee',
  observedDeformation: 'Left knee held in flexion',
  affectedSide: 'left',
  summary: 'Left knee flexion while standing',
  muscles: [
    muscle('Left Biceps Femoris', 'knee', 30),
    muscle('Left Semitendinosus', 'knee', 20),
    muscle('Left Gastrocnemius', 'lower_leg_ankle', 15),
    muscle('Left Rectus Femoris', 'thigh', 10),
    muscle('Left Vastus Medialis', 'thigh', 10),
    muscle('Left Popliteus', 'knee', 5),
    // Deliberately off: real Gemini output rarely sums to exactly 100.
    muscle('Left Gluteus Maximus', 'pelvis_hip', 20),
  ],
};

/** Posture payload exactly as the client builds it, via the real vision module. */
async function clientPostureForBentLeftKnee(): Promise<PostureMetrics> {
  const visionDir = path.resolve(__dirname, '../../../../vision');
  const posture = await import(pathToFileURL(path.join(visionDir, 'pose/postureMetrics.ts')).href);
  const fixtures = await import(pathToFileURL(path.join(visionDir, 'test/fixtures.ts')).href);
  const frames = Array.from({ length: 6 }, () => {
    const lm = fixtures.blankLandmarks(0);
    const set = (name: string, x: number, y: number) => fixtures.setLandmark(lm, name, { x, y, z: 0, visibility: 0.95 });
    set('nose', 0.5, 0.12); set('leftEye', 0.53, 0.1); set('rightEye', 0.47, 0.1);
    set('leftEar', 0.56, 0.11); set('rightEar', 0.44, 0.11);
    set('leftShoulder', 0.62, 0.3); set('rightShoulder', 0.38, 0.3);
    set('leftElbow', 0.64, 0.45); set('rightElbow', 0.36, 0.45);
    set('leftWrist', 0.65, 0.58); set('rightWrist', 0.35, 0.58);
    set('leftHip', 0.56, 0.56); set('rightHip', 0.44, 0.56);
    set('leftKnee', 0.62, 0.74); set('rightKnee', 0.44, 0.74);
    set('leftAnkle', 0.56, 0.92); set('rightAnkle', 0.44, 0.92);
    set('leftHeel', 0.56, 0.94); set('rightHeel', 0.44, 0.94);
    set('leftFootIndex', 0.57, 0.95); set('rightFootIndex', 0.43, 0.95);
    return { landmarks: lm, confidence: 0.95, timestamp: 0, frameAspect: 1 };
  });
  // Round-trip through JSON like the multipart upload does.
  return postureMetricsSchema.parse(JSON.parse(JSON.stringify(posture.summarizePosture(frames))));
}

function jobWith(postureMetrics: unknown) {
  return {
    id: 'job-1',
    patientId: 'patient-1',
    userId: 'user-1',
    scanId: null,
    status: 'QUEUED',
    analysisResult: null,
    generatedImages: [],
    meshyJobs: [],
    scan: { type: 'BODY_360', postureMetrics },
  };
}

type Saved = {
  bodyRegion: string;
  findings: Array<{ name: string; contributionPercent: number }>;
};

beforeEach(() => {
  db.saved = [];
  db.failures = [];
  db.allowFailure = false;
  gemini.responses = [];
  gemini.prompts = [];
});

describe('analysis pipeline with client posture metrics', () => {
  it('client posture payload satisfies the server contract and leads with the knee', async () => {
    const posture = await clientPostureForBentLeftKnee();
    expect(posture.findings[0]?.region).toBe('knee');
  });

  it('puts the measured deviations into the Gemini prompt', async () => {
    db.job = jobWith(await clientPostureForBentLeftKnee());
    gemini.responses = [kneeAnswer];
    await processAnalysisJob('job-1');
    expect(gemini.prompts).toHaveLength(1);
    expect(gemini.prompts[0]).toContain('OBJECTIVE POSE MEASUREMENTS');
    expect(gemini.prompts[0]).toMatch(/Left knee held bent/);
    expect(gemini.prompts[0]).toContain('Do NOT default to the shoulders');
  });

  it('re-asks once when the answer ignores a measured bent knee, and saves the corrected answer', async () => {
    db.job = jobWith(await clientPostureForBentLeftKnee());
    gemini.responses = [shoulderOnlyAnswer, kneeAnswer];
    await processAnalysisJob('job-1');
    expect(gemini.prompts).toHaveLength(2);
    expect(gemini.prompts[1]).toContain('CORRECTION REQUIRED');
    const saved = db.saved[0] as Saved;
    expect(saved.bodyRegion).toBe('knee');
    expect(saved.findings.map((f) => f.name)).toContain('Left Biceps Femoris');
  });

  it('flags the saved analysis when the retried answer still ignores the measurement (#8)', async () => {
    db.job = jobWith(await clientPostureForBentLeftKnee());
    gemini.responses = [shoulderOnlyAnswer, shoulderOnlyAnswer];
    await processAnalysisJob('job-1');
    expect(gemini.prompts).toHaveLength(2);
    const saved = db.saved[0] as Saved & { summary: string; parsed: { measurementConflict?: string; summary: string } };
    // Flagged for clinicians in its own field; the summary (also shown to patients) is untouched.
    expect(saved.parsed.measurementConflict).toMatch(/did not account for/i);
    expect(saved.parsed.measurementConflict).toMatch(/knee/i);
    expect(saved.summary).toBe(shoulderOnlyAnswer.summary);
    expect(saved.parsed.summary).toBe(shoulderOnlyAnswer.summary);
  });

  it('records muscle names outside the catalogue instead of saving them (#17)', async () => {
    db.job = jobWith(await clientPostureForBentLeftKnee());
    gemini.responses = [{ ...kneeAnswer, muscles: [...kneeAnswer.muscles, muscle('Left Imaginary Muscle', 'knee', 5)] }];
    await processAnalysisJob('job-1');
    const saved = db.saved[0] as Saved & { parsed: { invalidMuscleNames?: string[] } };
    expect(saved.findings.map((f) => f.name)).not.toContain('Left Imaginary Muscle');
    expect(saved.parsed.invalidMuscleNames).toEqual(['Left Imaginary Muscle']);
    expect(gemini.prompts).toHaveLength(1);
  });

  it('fails the job, without another paid call, when no muscle name is valid (#17)', async () => {
    db.job = jobWith(null);
    db.allowFailure = true;
    gemini.responses = [{ ...shoulderOnlyAnswer, muscles: [muscle('Nonsense One', 'shoulder', 50), muscle('Nonsense Two', 'shoulder', 50)] }];
    await processAnalysisJob('job-1');
    expect(db.saved).toHaveLength(0);
    expect(db.failures[0]).toMatch(/catalogue/i);
    expect(gemini.prompts).toHaveLength(1);
  });

  it('still analyses legacy jobs created without a scan (#16)', async () => {
    db.job = { ...jobWith(null), scan: null };
    gemini.responses = [kneeAnswer];
    await processAnalysisJob('job-1');
    expect(db.saved).toHaveLength(1);
    expect(gemini.prompts[0]).toContain('none available');
  });

  it('saves every muscle with contributions summing to 100, largest first', async () => {
    db.job = jobWith(await clientPostureForBentLeftKnee());
    gemini.responses = [kneeAnswer];
    await processAnalysisJob('job-1');
    const saved = db.saved[0] as Saved;
    expect(saved.findings).toHaveLength(kneeAnswer.muscles.length);
    const total = saved.findings.reduce((sum, f) => sum + f.contributionPercent, 0);
    expect(total).toBeCloseTo(100, 5);
    const shares = saved.findings.map((f) => f.contributionPercent);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
  });

  it('runs without posture metrics (older scans) and does not re-ask', async () => {
    db.job = jobWith(null);
    gemini.responses = [shoulderOnlyAnswer];
    await processAnalysisJob('job-1');
    expect(gemini.prompts).toHaveLength(1);
    expect(gemini.prompts[0]).toContain('none available');
    expect((db.saved[0] as Saved).bodyRegion).toBe('shoulder');
  });

  it('ignores a malformed stored posture payload instead of failing the job', async () => {
    db.job = jobWith({ version: 99, junk: true });
    gemini.responses = [kneeAnswer];
    await processAnalysisJob('job-1');
    expect(gemini.prompts[0]).toContain('none available');
    expect(db.saved).toHaveLength(1);
  });
});
