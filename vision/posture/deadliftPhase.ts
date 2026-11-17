export type DeadliftPhase = 'setup' | 'initial_pull' | 'knee_transition' | 'lockout' | 'lowering';

export interface DeadliftPhaseInput {
  trunkLeanDeg: number;
  /** Included knee angle, 180° straight. Null when the shin is not visible. */
  kneeIncludedDeg: number | null;
  /** Image y of the hip. Smaller is higher in the frame. */
  hipY: number;
}

export interface DeadliftPhaseConfig {
  engagedTrunkLeanDeg: number;
  extendedKneeDeg: number;
  flexedKneeDeg: number;
}

export interface DeadliftPhaseState {
  phase: DeadliftPhase;
  /** The trunk has been hinged at least once, so the opening stance is not a finished lockout. */
  sawHinge: boolean;
  /** Lockout after a hinge. The next increase in lean is the descent, not the setup. */
  sawLockout: boolean;
  prevHipY: number | null;
  prevLean: number | null;
}

const HIP_MOVE = 0.006;
const LEAN_MOVE_DEG = 2;

export function initialDeadliftPhaseState(): DeadliftPhaseState {
  return { phase: 'setup', sawHinge: false, sawLockout: false, prevHipY: null, prevLean: null };
}

/** Label where a deadlift rep is. The label does not change the rounding class. */
export function stepDeadliftPhase(
  state: DeadliftPhaseState,
  sample: DeadliftPhaseInput,
  config: DeadliftPhaseConfig,
): DeadliftPhaseState {
  const upright = sample.trunkLeanDeg < config.engagedTrunkLeanDeg;
  const knee = sample.kneeIncludedDeg;
  const kneeExtended = knee === null ? upright : knee >= config.extendedKneeDeg;
  const kneeFlexed = knee === null ? !upright : knee < config.flexedKneeDeg;
  const hipRising = state.prevHipY !== null && state.prevHipY - sample.hipY > HIP_MOVE;
  const hipFalling = state.prevHipY !== null && sample.hipY - state.prevHipY > HIP_MOVE;
  const leanIncreasing = state.prevLean !== null && sample.trunkLeanDeg > state.prevLean + LEAN_MOVE_DEG;
  const leanDecreasing = state.prevLean !== null && sample.trunkLeanDeg < state.prevLean - LEAN_MOVE_DEG;

  const sawHinge = state.sawHinge || !upright;
  let sawLockout = state.sawLockout;
  if (upright && kneeExtended && sawHinge) sawLockout = true;

  let phase: DeadliftPhase;
  if (upright && kneeExtended) phase = 'lockout';
  else if (sawLockout && (leanIncreasing || hipFalling) && !leanDecreasing) phase = 'lowering';
  else if (!upright && kneeFlexed && (hipRising || leanDecreasing)) phase = 'initial_pull';
  else if (!upright && !kneeFlexed && !kneeExtended) phase = 'knee_transition';
  else if (!upright && kneeFlexed) phase = 'setup';
  else phase = 'setup';

  if (phase === 'lowering' && leanDecreasing && !upright) {
    sawLockout = false;
    phase = kneeFlexed ? 'initial_pull' : 'knee_transition';
  }

  return { phase, sawHinge, sawLockout, prevHipY: sample.hipY, prevLean: sample.trunkLeanDeg };
}
