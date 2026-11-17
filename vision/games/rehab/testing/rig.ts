import type { PoseResult } from '../../../types';
import { DEFAULT_MOCK_PARAMS, mockPose, type MockParams } from '../core/mockSkeleton';
import { RehabTracker } from '../core/tracking';
import type { BasePose, RehabFrame, TrackingStatus } from '../core/types';

/**
 * Test support (not a test): drives the mock skeleton through the real
 * RehabTracker at a fixed frame rate, the way the app feeds the games.
 */
export const FPS = 30;
export const DT = 1 / FPS;

export interface RigOptions {
  seated?: boolean;
  params?: Partial<MockParams>;
  t0?: number;
}

export class Rig {
  readonly tracker: RehabTracker;
  params: MockParams;
  t: number;
  status: TrackingStatus | null = null;

  constructor(requiredLandmarks: readonly number[], options: RigOptions = {}) {
    this.tracker = new RehabTracker({ requiredLandmarks, seated: options.seated });
    this.params = { ...DEFAULT_MOCK_PARAMS, ...options.params };
    this.t = options.t0 ?? 0;
  }

  set(patch: Partial<MockParams>): void {
    this.params = { ...this.params, ...patch };
  }

  /**
   * One frame. `patch` changes the standing params; `pose` overrides the
   * mock (null = nobody detected).
   */
  step(patch?: Partial<MockParams>, pose?: PoseResult | null): TrackingStatus {
    if (patch) this.set(patch);
    this.t += DT;
    const p = pose !== undefined ? pose : mockPose(this.params, this.t);
    this.status = this.tracker.update(p, this.t);
    return this.status;
  }

  /** Stand still until the base pose locks. Throws if it never does. */
  lockBase(maxSeconds = 6): BasePose {
    for (let i = 0; i < maxSeconds * FPS; i += 1) {
      this.step();
      const base = this.tracker.getBase();
      if (base) return base;
    }
    throw new Error(`base did not lock in ${maxSeconds} s (last message: ${this.status?.message ?? 'none'})`);
  }

  get base(): BasePose {
    const b = this.tracker.getBase();
    if (!b) throw new Error('no base yet');
    return b;
  }

  /** The current frame when tracking is healthy, as the engine passes it to a game. */
  get healthyFrame(): RehabFrame | null {
    const s = this.status;
    return s && s.healthy && s.frame && this.tracker.getBase() ? s.frame : null;
  }
}

/** Piecewise-linear profile: [[time, value], ...] sorted by time, held flat outside. */
export function ramp(points: readonly (readonly [number, number])[], t: number): number {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [t1, v1] = points[i];
    const [t0, v0] = points[i - 1];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return points[points.length - 1][1];
}
