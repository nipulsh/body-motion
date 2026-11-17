import type { CalibrationStatus, NeutralSpineProfile } from './NeutralSpineCalibrator';

/** Camera-outline classes. "Possible" means the outline estimate, not a spinal finding. */
export type PostureClassification =
  | 'neutral'
  | 'possible_upper_back_rounding'
  | 'possible_lower_back_rounding'
  | 'possible_combined_rounding'
  | 'insufficient_tracking';

export type DeadliftRoundingCode =
  | 'possible_upper_back_rounding'
  | 'possible_lower_back_rounding'
  | 'possible_combined_rounding';

export interface RoundingLatch {
  thoracic: boolean;
  lumbar: boolean;
}

export interface ClassifyConfig {
  thoracicEnterDelta: number;
  lumbarEnterDelta: number;
  deltaRelease: number;
  minContourConfidence: number;
}

export interface ClassifyInput {
  thoracicSagitta: number | null;
  lumbarSagitta: number | null;
  thoracicConfidence: number;
  lumbarConfidence: number;
  baseline: NeutralSpineProfile | null;
  calibration: CalibrationStatus;
  latch: RoundingLatch;
  /** False while the trunk is still upright: lean is not rounding. */
  engaged: boolean;
  /**
   * T8, T3 and C7 have left a line by more than the threshold over the standing baseline. Counts
   * as upper-back rounding on its own. The caller keeps its hysteresis, so it does not touch the
   * sagitta latch.
   */
  upperBackLineBent?: boolean;
}

export interface ClassifyResult {
  classification: PostureClassification;
  fault: DeadliftRoundingCode | null;
  latch: RoundingLatch;
  thoracicDelta: number | null;
  lumbarDelta: number | null;
}

const OPEN: RoundingLatch = { thoracic: false, lumbar: false };

function delta(sagitta: number | null, baseline: number): number | null {
  if (sagitta === null || !Number.isFinite(sagitta)) return null;
  return sagitta - baseline;
}

function latched(value: number, enter: number, wasLatched: boolean, release: number): boolean {
  return value > enter * (wasLatched ? release : 1);
}

/**
 * Compare smoothed regional sagittas with the standing baseline.
 * Trunk lean is not an input: a hinged flat outline stays neutral.
 */
export function classifyPosture(input: ClassifyInput, config: ClassifyConfig): ClassifyResult {
  const thoracicDelta = input.baseline ? delta(input.thoracicSagitta, input.baseline.thoracicSagitta) : null;
  const lumbarDelta = input.baseline ? delta(input.lumbarSagitta, input.baseline.lumbarSagitta) : null;
  const confident =
    input.thoracicSagitta !== null &&
    input.lumbarSagitta !== null &&
    input.thoracicConfidence >= config.minContourConfidence &&
    input.lumbarConfidence >= config.minContourConfidence;

  if (input.calibration !== 'ready' || !input.baseline) {
    return {
      classification: 'insufficient_tracking',
      fault: null,
      latch: OPEN,
      thoracicDelta: null,
      lumbarDelta: null,
    };
  }

  if (!input.engaged) {
    return {
      classification: confident ? 'neutral' : 'insufficient_tracking',
      fault: null,
      latch: OPEN,
      thoracicDelta,
      lumbarDelta,
    };
  }

  if (!confident || thoracicDelta === null || lumbarDelta === null) {
    return {
      classification: 'insufficient_tracking',
      fault: null,
      latch: input.latch,
      thoracicDelta,
      lumbarDelta,
    };
  }

  const thoracic = latched(thoracicDelta, config.thoracicEnterDelta, input.latch.thoracic, config.deltaRelease);
  const lumbar = latched(lumbarDelta, config.lumbarEnterDelta, input.latch.lumbar, config.deltaRelease);
  const latch = { thoracic, lumbar };
  const upper = thoracic || input.upperBackLineBent === true;
  if (upper && lumbar) {
    return { classification: 'possible_combined_rounding', fault: 'possible_combined_rounding', latch, thoracicDelta, lumbarDelta };
  }
  if (upper) {
    return { classification: 'possible_upper_back_rounding', fault: 'possible_upper_back_rounding', latch, thoracicDelta, lumbarDelta };
  }
  if (lumbar) {
    return { classification: 'possible_lower_back_rounding', fault: 'possible_lower_back_rounding', latch, thoracicDelta, lumbarDelta };
  }
  return { classification: 'neutral', fault: null, latch, thoracicDelta, lumbarDelta };
}
