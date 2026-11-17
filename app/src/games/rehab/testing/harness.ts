import type { PoseResult } from '@vision';
import { DEFAULT_MOCK_PARAMS, mockPose, type MockParams } from '@vision/games/rehab/core/mockSkeleton';
import { RehabEngine, type SessionEnd } from '../core/engine';
import type { GameModule, OptionValues } from '../core/module';
import { DEFAULT_SETTINGS, type RehabSettings } from '../core/settings';
import { clock, type FakeAudio } from './fakes';

/**
 * Test support (not a test): runs the real RehabEngine the way
 * MirrorRehabScreen does: mock pose provider at 30 fps (with the game's
 * scripted demo when on), one engine tick per frame. The test file must mock
 * `three`'s WebGLRenderer, `../core/audio` and `../core/storage` (see fakes.ts).
 */
export const FPS = 30;
export const DT = 1 / FPS;

export class Harness {
  readonly engine: RehabEngine;
  readonly ends: SessionEnd[] = [];
  params: MockParams;
  /** Mock provider time, seconds. */
  t = 0;
  demo = false;
  /** Camera delay: each pose reaches the engine this many frames after the body was in it. */
  cameraDelayFrames = 0;
  private queue: (PoseResult | null)[] = [];

  constructor(settings: Partial<RehabSettings> = {}, params: Partial<MockParams> = {}) {
    clock.ms = 1000;
    this.engine = new RehabEngine({ ...structuredClone(DEFAULT_SETTINGS), ...settings });
    this.engine.display.resize(1080, 1920);
    this.engine.attachCanvas({} as HTMLCanvasElement);
    this.engine.onEnd = (e) => this.ends.push(e);
    this.params = { ...DEFAULT_MOCK_PARAMS, ...params };
  }

  get audio(): FakeAudio {
    return this.engine.audio as unknown as FakeAudio;
  }

  start(module: GameModule, levelIndex: number, options: OptionValues = {}): void {
    const merged = { ...module.defaultOptions, ...options };
    const opts = module.normalizeOptions ? module.normalizeOptions(merged) : merged;
    const level = module.levels(opts)[levelIndex];
    this.engine.start(module, level, opts, module.landmarksFor?.(level, opts) ?? module.requiredLandmarks, module.seatedFor?.(opts) ?? false);
  }

  /** One frame: pose in, engine tick. `pose` overrides the mock (null = nobody). */
  step(patch?: Partial<MockParams>, pose?: (p: PoseResult) => PoseResult | null): void {
    if (patch) this.params = { ...this.params, ...patch };
    this.t += DT;
    clock.ms += DT * 1000;
    this.audio.advance(DT);
    const d = this.demo ? this.engine.session?.demo?.(this.t, this.params, this.engine.status?.frame ?? null) : null;
    const params = d ? { ...this.params, ...d } : this.params;
    let p = mockPose(params, this.t);
    if (p && pose) p = pose(p);
    this.queue.push(p);
    const delivered = this.queue.length > this.cameraDelayFrames ? this.queue.shift()! : null;
    // Stamped when it arrives, as the camera pipeline does.
    if (delivered) delivered.timestamp = clock.ms;
    this.engine.onPose(delivered);
    this.engine.tick(clock.ms, 1);
  }

  run(seconds: number, patch?: (t: number) => Partial<MockParams>): void {
    const n = Math.round(seconds * FPS);
    for (let i = 0; i < n; i += 1) this.step(patch?.(i * DT));
  }

  /** Step until `done` or the time runs out; returns whether `done` became true. */
  until(done: () => boolean, maxSeconds: number, patch?: (t: number) => Partial<MockParams>): boolean {
    const n = Math.round(maxSeconds * FPS);
    for (let i = 0; i < n; i += 1) {
      if (done()) return true;
      this.step(patch?.(i * DT));
    }
    return done();
  }
}
