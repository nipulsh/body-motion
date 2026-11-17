import { postureMetricsSchema, type PostureFinding, type PostureMetrics } from '../schemas/posture.schema';

/**
 * Server-owned copy of the posture metric table in `vision/pose/postureMetrics.ts`
 * (a contract test keeps thresholds and regions in step).
 *
 * The client only supplies numbers. Every word that reaches the Gemini prompt (descriptions,
 * regions, muscle groups) and every severity is produced here, so an altered client cannot
 * inject instructions into the prompt or inflate severities.
 */
type MuscleGroup = PostureFinding['muscleGroups'][number];

interface MetricRule {
  region: PostureFinding['region'];
  threshold: number;
  unit: PostureFinding['unit'];
  muscleGroups: MuscleGroup[];
  /** Positive values point at the patient's left. */
  signed: boolean;
  side?: 'left' | 'right';
  /**
   * Frames this metric is measured on (see vision measureFrame): front-on only, side-on only,
   * or any view (joint angles between body segments).
   */
  view: 'front' | 'side' | 'any';
  /** Physically plausible magnitude; anything larger is discarded as bad data. */
  maxAbs: number;
  describe: (value: number) => string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const sideWord = (value: number) => (value > 0 ? 'left' : 'right');
const Side = (value: number) => (value > 0 ? 'Left' : 'Right');

export const POSTURE_METRIC_RULES: Record<string, MetricRule> = {
  headTiltDeg: {
    view: 'front',
    region: 'head_neck', threshold: 4, unit: 'deg', muscleGroups: ['HEAD_NECK'], signed: true, maxAbs: 60,
    describe: (v) => `Head tilted ${round1(Math.abs(v))}° toward the ${sideWord(v)} (eye line vs body horizontal)`,
  },
  forwardHeadDeg: {
    view: 'side',
    region: 'head_neck', threshold: 15, unit: 'deg', muscleGroups: ['HEAD_NECK', 'BACK'], signed: false, maxAbs: 90,
    describe: (v) => `Forward head posture: ear ${round1(v)}° ahead of the shoulder (side view)`,
  },
  shoulderTiltDeg: {
    view: 'front',
    region: 'shoulder', threshold: 3, unit: 'deg', muscleGroups: ['SHOULDER', 'BACK', 'HEAD_NECK'], signed: true, maxAbs: 45,
    describe: (v) => `${Side(v)} shoulder sits lower (shoulder line ${round1(Math.abs(v))}° off level)`,
  },
  shoulderElevationAsymmetryPct: {
    view: 'front',
    region: 'shoulder', threshold: 10, unit: 'percent', muscleGroups: ['SHOULDER', 'HEAD_NECK'], signed: true, maxAbs: 100,
    describe: (v) => `${Side(v)} shoulder hitched toward the ear (${round1(Math.abs(v))}% of shoulder width)`,
  },
  leftElbowFlexionDeg: {
    view: 'any',
    region: 'elbow', threshold: 25, unit: 'deg', muscleGroups: ['UPPER_ARM', 'FOREARM'], signed: false, side: 'left', maxAbs: 180,
    describe: (v) => `Left elbow held bent ${round1(v)}° at rest`,
  },
  rightElbowFlexionDeg: {
    view: 'any',
    region: 'elbow', threshold: 25, unit: 'deg', muscleGroups: ['UPPER_ARM', 'FOREARM'], signed: false, side: 'right', maxAbs: 180,
    describe: (v) => `Right elbow held bent ${round1(v)}° at rest`,
  },
  trunkLateralLeanDeg: {
    view: 'front',
    region: 'trunk', threshold: 4, unit: 'deg', muscleGroups: ['BACK', 'ABDOMEN'], signed: true, maxAbs: 60,
    describe: (v) => `Trunk leans ${round1(Math.abs(v))}° toward the ${sideWord(v)}`,
  },
  trunkForwardLeanDeg: {
    view: 'side',
    region: 'trunk', threshold: 10, unit: 'deg', muscleGroups: ['BACK', 'ABDOMEN', 'HIP'], signed: false, maxAbs: 90,
    describe: (v) => `Trunk pitched ${round1(v)}° forward (side view)`,
  },
  pelvisTiltDeg: {
    view: 'front',
    region: 'pelvis_hip', threshold: 3, unit: 'deg', muscleGroups: ['HIP', 'BACK', 'ABDOMEN'], signed: true, maxAbs: 45,
    describe: (v) => `${Side(v)} hip sits lower (pelvis ${round1(Math.abs(v))}° off level)`,
  },
  leftHipFlexionDeg: {
    view: 'any',
    region: 'pelvis_hip', threshold: 15, unit: 'deg', muscleGroups: ['HIP', 'UPPER_LEG'], signed: false, side: 'left', maxAbs: 180,
    describe: (v) => `Left hip held flexed ${round1(v)}°`,
  },
  rightHipFlexionDeg: {
    view: 'any',
    region: 'pelvis_hip', threshold: 15, unit: 'deg', muscleGroups: ['HIP', 'UPPER_LEG'], signed: false, side: 'right', maxAbs: 180,
    describe: (v) => `Right hip held flexed ${round1(v)}°`,
  },
  leftKneeFlexionDeg: {
    view: 'any',
    region: 'knee', threshold: 15, unit: 'deg', muscleGroups: ['UPPER_LEG', 'LOWER_LEG'], signed: false, side: 'left', maxAbs: 180,
    describe: (v) => `Left knee held bent ${round1(v)}° while standing`,
  },
  rightKneeFlexionDeg: {
    view: 'any',
    region: 'knee', threshold: 15, unit: 'deg', muscleGroups: ['UPPER_LEG', 'LOWER_LEG'], signed: false, side: 'right', maxAbs: 180,
    describe: (v) => `Right knee held bent ${round1(v)}° while standing`,
  },
  kneeFlexionAsymmetryDeg: {
    view: 'any',
    region: 'knee', threshold: 8, unit: 'deg', muscleGroups: ['UPPER_LEG', 'LOWER_LEG', 'HIP'], signed: true, maxAbs: 180,
    describe: (v) => `${Side(v)} knee bent ${round1(Math.abs(v))}° more than the other`,
  },
  leftKneeValgusDeg: {
    view: 'front',
    region: 'knee', threshold: 8, unit: 'deg', muscleGroups: ['UPPER_LEG', 'HIP', 'LOWER_LEG'], signed: false, side: 'left', maxAbs: 90,
    describe: (v) => (v >= 0 ? `Left knee drifts inward (valgus) ${round1(v)}°` : `Left knee bows outward (varus) ${round1(-v)}°`),
  },
  rightKneeValgusDeg: {
    view: 'front',
    region: 'knee', threshold: 8, unit: 'deg', muscleGroups: ['UPPER_LEG', 'HIP', 'LOWER_LEG'], signed: false, side: 'right', maxAbs: 90,
    describe: (v) => (v >= 0 ? `Right knee drifts inward (valgus) ${round1(v)}°` : `Right knee bows outward (varus) ${round1(-v)}°`),
  },
  legLengthDifferencePct: {
    view: 'front',
    region: 'leg', threshold: 4, unit: 'percent', muscleGroups: ['HIP', 'UPPER_LEG', 'LOWER_LEG'], signed: true, maxAbs: 50,
    describe: (v) => `${Side(v)} leg appears ${round1(Math.abs(v))}% shorter (hip-to-ankle, camera plane)`,
  },
};

/** Rank the notable deviations from known, in-range metric values. */
export function deriveFindings(metrics: Record<string, number>): PostureFinding[] {
  const findings: PostureFinding[] = [];
  for (const [metric, value] of Object.entries(metrics)) {
    const rule = POSTURE_METRIC_RULES[metric];
    if (!rule) continue;
    const severity = Math.abs(value) / rule.threshold;
    if (severity < 1) continue;
    findings.push({
      region: rule.region,
      side: rule.side ?? (rule.signed ? (value > 0 ? 'left' : 'right') : 'bilateral'),
      metric,
      value: round1(value),
      unit: rule.unit,
      threshold: rule.threshold,
      severity: Math.round(severity * 100) / 100,
      muscleGroups: rule.muscleGroups,
      description: rule.describe(value),
    });
  }
  return findings.sort((a, b) => b.severity - a.severity);
}

/**
 * Samples a median needs before it is reported. Matches the client, which only emits a metric
 * once it has three agreeing frames (vision summarizePosture), so honest payloads never lose data.
 */
export const MIN_POSTURE_SAMPLES = 3;

export interface SanitizeOptions {
  /** Images uploaded with the payload; more measured frames than images is impossible. */
  uploadedImages?: number;
}

/**
 * The left–right knee difference is a median of per-frame differences, so it need not equal
 * the difference of the per-side medians. Its sign must still agree once the per-side values
 * differ by more than the asymmetry's own screening threshold; otherwise the payload contradicts
 * itself and the asymmetry is dropped.
 */
function dropContradictoryAsymmetry(metrics: Record<string, number>): void {
  const left = metrics.leftKneeFlexionDeg;
  const right = metrics.rightKneeFlexionDeg;
  const asymmetry = metrics.kneeFlexionAsymmetryDeg;
  if (left === undefined || right === undefined || asymmetry === undefined) return;
  const difference = left - right;
  const threshold = POSTURE_METRIC_RULES.kneeFlexionAsymmetryDeg!.threshold;
  if (Math.abs(difference) >= threshold && Math.sign(difference) !== Math.sign(asymmetry)) {
    delete metrics.kneeFlexionAsymmetryDeg;
  }
}

/**
 * Accept a client posture payload (or a stored one) as numbers only. Unknown metric names,
 * implausible values and metrics without enough frames of the right view are dropped; frame
 * counts must add up; findings and severities are rebuilt from the server's own rules.
 * Returns null for anything that is not a consistent version-1 summary with a usable metric.
 *
 * The server cannot see landmarks, so an authenticated client can still report false numbers
 * within these limits; it can no longer inject text, inflate severity, or skip the checks.
 */
export function sanitizePostureMetrics(raw: unknown, options: SanitizeOptions = {}): PostureMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  if (input.version !== 1) return null;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1;
  const frameCount = count(input.frameCount);
  const frontalFrames = count(input.frontalFrames);
  const sideFrames = count(input.sideFrames);
  if (frameCount < 0 || frontalFrames < 0 || sideFrames < 0) return null;
  if (frontalFrames + sideFrames > frameCount) return null;
  if (options.uploadedImages !== undefined && frameCount > options.uploadedImages) return null;

  const framesFor: Record<MetricRule['view'], number> = {
    front: frontalFrames,
    side: sideFrames,
    any: frameCount,
  };
  const metrics: Record<string, number> = {};
  if (input.metrics && typeof input.metrics === 'object') {
    for (const [key, value] of Object.entries(input.metrics as Record<string, unknown>)) {
      const rule = POSTURE_METRIC_RULES[key];
      if (!rule || typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (Math.abs(value) > rule.maxAbs) continue;
      if (framesFor[rule.view] < MIN_POSTURE_SAMPLES) continue;
      metrics[key] = round1(value);
    }
  }
  dropContradictoryAsymmetry(metrics);
  // Nothing measurable left: treat like no posture data at all.
  if (Object.keys(metrics).length === 0) return null;
  const sanitized = {
    version: 1 as const,
    frameCount,
    frontalFrames,
    sideFrames,
    metrics,
    findings: deriveFindings(metrics),
  };
  const parsed = postureMetricsSchema.safeParse(sanitized);
  return parsed.success ? parsed.data : null;
}

/** Parse the optional multipart `postureMetrics` field. Malformed input is dropped, not fatal. */
export function parsePostureMetricsField(raw: unknown, options: SanitizeOptions = {}): PostureMetrics | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 64_000) return null;
  try {
    return sanitizePostureMetrics(JSON.parse(raw), options);
  } catch {
    return null;
  }
}
