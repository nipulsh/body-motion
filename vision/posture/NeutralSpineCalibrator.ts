/**
 * Where a back reading came from. The two run on different scales, so a baseline from one
 * can never be compared with a reading from the other.
 */
export type SpineSignalSource = 'outline' | 'spinepose';

/** Versioned standing side-view baseline. Sagittas are fractions of hip–shoulder length. */
export interface NeutralSpineProfile {
  version: 1;
  /** Absent on an outline baseline, including ones saved before keypoints existed. */
  source?: 'spinepose';
  capturedAt: number;
  thoracicSagitta: number;
  lumbarSagitta: number;
  trunkLeanDeg: number;
  /** Included angle at the hip, shoulder–hip–knee, in degrees. */
  hipAngleDeg: number;
  /** Median hip–shoulder length in the camera plane (image-height units). */
  hipShoulderScale: number;
  sampleCount: number;
  /** Median standing spine bend in degrees. Keypoints only. */
  bendDeg?: number;
  /** Median standing T8–T3–C7 turn in degrees. Keypoints only. */
  upperBackLineDeg?: number;
  /** Median standing hip centre → L3 tilt in degrees. Keypoints only. */
  pelvicTiltDeg?: number;
}

export type CalibrationStatus = 'ready' | 'missing' | 'invalid' | 'stale';

export interface NeutralCalibrationConfig {
  minFrames: number;
  minDurationMs: number;
  maxAgeMs: number;
  maxTrunkLeanDeg: number;
  minContourConfidence: number;
  /** A longer wait than this between samples starts over. A slow model needs more than the default. */
  sampleGapMs?: number;
}

export interface NeutralSpineObservation {
  thoracicSagitta: number;
  lumbarSagitta: number;
  thoracicConfidence: number;
  lumbarConfidence: number;
  trunkLeanDeg: number;
  hipAngleDeg: number;
  hipShoulderScale: number;
  upright: boolean;
  sideOn: boolean;
  bendDeg?: number | null;
  upperBackLineDeg?: number | null;
  pelvicTiltDeg?: number | null;
}

export const NEUTRAL_SPINE_PROFILE_VERSION = 1;

const SAMPLE_GAP_MS = 300;

type ProfileListener = (profile: NeutralSpineProfile | null, source: SpineSignalSource) => void;

const stored: Record<SpineSignalSource, NeutralSpineProfile | null> = { outline: null, spinepose: null };
const listeners = new Set<ProfileListener>();

function sourceOf(profile: { source?: unknown }): SpineSignalSource {
  return profile.source === 'spinepose' ? 'spinepose' : 'outline';
}

export function getNeutralSpineProfile(source: SpineSignalSource = 'outline'): NeutralSpineProfile | null {
  return stored[source];
}

/** A profile goes to the slot it says it belongs to. `source` only names the slot when clearing one. */
export function setNeutralSpineProfile(profile: NeutralSpineProfile | null, source?: SpineSignalSource): void {
  const slot = profile ? sourceOf(profile) : (source ?? 'outline');
  stored[slot] = profile;
  for (const listener of listeners) listener(profile, slot);
}

export function subscribeNeutralSpineProfile(listener: ProfileListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drop the in-memory baselines. Tests use this so one file cannot calibrate the next. */
export function resetNeutralSpineProfile(): void {
  setNeutralSpineProfile(null, 'outline');
  setNeutralSpineProfile(null, 'spinepose');
}

export function assessNeutralSpineProfile(
  input: unknown,
  now: number,
  maxAgeMs: number,
  source: SpineSignalSource = 'outline',
): { status: CalibrationStatus; profile: NeutralSpineProfile | null } {
  if (input == null) return { status: 'missing', profile: null };
  if (!isProfile(input) || sourceOf(input) !== source) return { status: 'invalid', profile: null };
  const age = now - input.capturedAt;
  if (age < 0) return { status: 'invalid', profile: null };
  if (age > maxAgeMs) return { status: 'stale', profile: null };
  return { status: 'ready', profile: input };
}

function isProfile(input: unknown): input is NeutralSpineProfile {
  if (!input || typeof input !== 'object') return false;
  const value = input as Record<string, unknown>;
  return (
    value.version === NEUTRAL_SPINE_PROFILE_VERSION &&
    typeof value.capturedAt === 'number' &&
    Number.isFinite(value.capturedAt) &&
    finiteNumber(value.thoracicSagitta) &&
    finiteNumber(value.lumbarSagitta) &&
    finiteNumber(value.trunkLeanDeg) &&
    finiteNumber(value.hipAngleDeg) &&
    finiteNumber(value.hipShoulderScale) &&
    (value.hipShoulderScale as number) > 0 &&
    typeof value.sampleCount === 'number' &&
    value.sampleCount > 0
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Collects upright side-view frames and stores their median contour as the person's baseline.
 * A baseline that is already ready is kept: locking out between reps does not overwrite it.
 */
export class NeutralSpineCalibrator {
  private samples: NeutralSpineObservation[] = [];
  private sampleTimes: number[] = [];

  constructor(
    private readonly config: NeutralCalibrationConfig,
    private readonly source: SpineSignalSource = 'outline',
  ) {}

  reset(): void {
    this.samples = [];
    this.sampleTimes = [];
  }

  /** The baseline as it stands, without counting this moment as a sample or as a gap. */
  current(): NeutralSpineProfile | null {
    const assessed = assessNeutralSpineProfile(getNeutralSpineProfile(this.source), Date.now(), this.config.maxAgeMs, this.source);
    return assessed.status === 'ready' ? assessed.profile : null;
  }

  observe(sample: NeutralSpineObservation | null, timestamp: number): NeutralSpineProfile | null {
    const assessed = assessNeutralSpineProfile(getNeutralSpineProfile(this.source), Date.now(), this.config.maxAgeMs, this.source);
    if (assessed.status === 'ready' && assessed.profile) return assessed.profile;
    if (assessed.status === 'stale' || assessed.status === 'invalid') setNeutralSpineProfile(null, this.source);
    const gap = this.config.sampleGapMs ?? SAMPLE_GAP_MS;
    if (!sample || !this.accepts(sample)) {
      if (this.sampleTimes.length > 0 && timestamp - this.sampleTimes[this.sampleTimes.length - 1]! > gap) {
        this.reset();
      }
      return null;
    }
    if (this.sampleTimes.length > 0 && timestamp - this.sampleTimes[this.sampleTimes.length - 1]! > gap) {
      this.reset();
    }
    this.samples.push(sample);
    this.sampleTimes.push(timestamp);
    const started = this.sampleTimes[0]!;
    if (this.samples.length < this.config.minFrames || timestamp - started < this.config.minDurationMs) return null;
    const profile = this.lock();
    setNeutralSpineProfile(profile);
    return profile;
  }

  private accepts(sample: NeutralSpineObservation): boolean {
    return (
      sample.upright &&
      sample.sideOn &&
      sample.thoracicConfidence >= this.config.minContourConfidence &&
      sample.lumbarConfidence >= this.config.minContourConfidence &&
      sample.trunkLeanDeg <= this.config.maxTrunkLeanDeg &&
      sample.hipShoulderScale > 0 &&
      Number.isFinite(sample.hipAngleDeg)
    );
  }

  private lock(): NeutralSpineProfile {
    const take = (read: (sample: NeutralSpineObservation) => number) => median(this.samples.map(read));
    const optional = (read: (sample: NeutralSpineObservation) => number | null | undefined) =>
      this.samples.map(read).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const bends = optional((sample) => sample.bendDeg);
    const lines = optional((sample) => sample.upperBackLineDeg);
    const pelvis = optional((sample) => sample.pelvicTiltDeg);
    return {
      version: NEUTRAL_SPINE_PROFILE_VERSION,
      ...(this.source === 'spinepose' ? { source: 'spinepose' as const } : {}),
      ...(bends.length > 0 ? { bendDeg: median(bends) } : {}),
      ...(lines.length > 0 ? { upperBackLineDeg: median(lines) } : {}),
      ...(pelvis.length > 0 ? { pelvicTiltDeg: median(pelvis) } : {}),
      capturedAt: Date.now(),
      thoracicSagitta: take((sample) => sample.thoracicSagitta),
      lumbarSagitta: take((sample) => sample.lumbarSagitta),
      trunkLeanDeg: take((sample) => sample.trunkLeanDeg),
      hipAngleDeg: take((sample) => sample.hipAngleDeg),
      hipShoulderScale: take((sample) => sample.hipShoulderScale),
      sampleCount: this.samples.length,
    };
  }
}
