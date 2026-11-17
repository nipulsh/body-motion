import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockParams } from '@vision/games/rehab/core/mockSkeleton';
import { clock } from '../testing/fakes';
import { DT, Harness } from '../testing/harness';
import { bubblesModule } from '../bubbles/bubblesModule';
import { marchModule } from '../march/marchModule';
import { squatModule } from '../squat/squatModule';
import type { GameModule, GameSession, HudState, ResultData } from './module';
import { recordStars, saveSession } from './storage';

vi.mock('three', async (importOriginal) => {
  const THREE = await importOriginal<typeof import('three')>();
  const { FakeWebGLRenderer } = await import('../testing/fakes');
  return { ...THREE, WebGLRenderer: FakeWebGLRenderer };
});
vi.mock('./audio', async () => ({ RehabAudio: (await import('../testing/fakes')).FakeAudio }));
vi.mock('./storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('./storage')>();
  return { ...real, saveSession: vi.fn(async () => {}), recordStars: vi.fn(), bestStars: vi.fn(() => 0) };
});

beforeEach(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => clock.ms);
  vi.mocked(saveSession).mockClear();
  vi.mocked(recordStars).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A stand-in game that records what the engine does to it. */
class ProbeSession implements GameSession {
  requiredView: 'front' | 'side' | 'either' = 'either';
  requiredLandmarks: readonly number[] = [11, 12, 23, 24];
  updates = 0;
  pauses = 0;
  resumes = 0;
  starts = 0;
  finished = false;
  hover = true;
  pauseRequest: string | null = null;
  update(): void {
    this.updates += 1;
  }
  render(): void {}
  hud(): HudState {
    return { levelName: 'probe', ring: 1, score: this.updates };
  }
  canUseHoverMenu(): boolean {
    return this.hover;
  }
  isFinished(): boolean {
    return this.finished;
  }
  result(): ResultData {
    return { stars: 3, score: 42, numbers: [], metrics: { updates: this.updates } };
  }
  pause(): void {
    this.pauses += 1;
  }
  resume(): void {
    this.resumes += 1;
  }
  start(): void {
    this.starts += 1;
  }
  takePauseRequest(): string | null {
    const r = this.pauseRequest;
    this.pauseRequest = null;
    return r;
  }
  dispose(): void {}
}

function probeModule(over: Partial<GameModule> = {}): { module: GameModule; session: () => ProbeSession } {
  let last: ProbeSession | null = null;
  const module: GameModule = {
    id: 'probe',
    name: 'Probe',
    icon: '',
    requiredView: 'either',
    requiredLandmarks: [11, 12, 23, 24],
    defaultOptions: {},
    levels: () => [1, 2, 3, 4, 5].map((n) => ({ id: `P${n}`, number: n, name: `P${n}` })),
    levelKey: (level) => level.id,
    lastLevelKey: () => 'probe',
    createSession: () => {
      last = new ProbeSession();
      return last;
    },
    ...over,
  };
  return {
    module,
    session: () => {
      if (!last) throw new Error('no session yet');
      return last;
    },
  };
}

/** Into play: base pose, countdown (and Ready when asked). */
function toPlay(h: Harness, patch?: (t: number) => Partial<MockParams>): void {
  const ok = h.until(
    () => {
      if (h.engine.phase === 'ready') h.engine.confirmReady();
      return h.engine.phase === 'playing';
    },
    15,
    patch,
  );
  if (!ok) throw new Error(`never reached play (phase ${h.engine.phase}, message ${h.engine.view().message})`);
}

describe('session flow', () => {
  it('base pose locks with no tap, then 3-2-1, then play', () => {
    const h = new Harness();
    const p = probeModule();
    h.start(p.module, 0);
    expect(h.engine.phase).toBe('base');
    expect(h.engine.view().message).toBe('Stand still');
    h.until(() => h.engine.phase === 'countdown', 4);
    expect(h.engine.phase).toBe('countdown');
    expect(h.t).toBeGreaterThan(2);
    h.run(2.9);
    expect(h.engine.phase).toBe('countdown');
    h.run(0.2);
    expect(h.engine.phase).toBe('playing');
    expect(p.session().starts).toBe(1);
    h.run(1);
    expect(p.session().updates).toBeGreaterThan(25);
  });

  it('a game that asks for it shows one Ready button with "Hold a rail or chair" before the countdown', () => {
    const h = new Harness();
    const p = probeModule({ requireReadyConfirm: () => true });
    h.start(p.module, 0);
    h.until(() => h.engine.phase === 'ready', 4);
    expect(h.engine.view().readyLine).toBe('Hold a rail or chair');
    h.run(5);
    expect(h.engine.phase).toBe('ready');
    h.engine.confirmReady();
    expect(h.engine.phase).toBe('countdown');
  });
});

describe('pauses', () => {
  it('tracking lost pauses the game and it resumes, in the same session, after 0.5 s of good tracking', () => {
    const h = new Harness();
    const p = probeModule();
    h.start(p.module, 0);
    toPlay(h);
    h.run(1);
    h.run(0.2, () => ({ tracking: false }));
    expect(h.engine.phase).toBe('paused');
    expect(h.engine.view().pauseKind).toBe('tracking');
    expect(h.engine.view().message).toBe('Stand where I can see you');
    expect(p.session().pauses).toBe(1);
    const updates = p.session().updates;
    h.run(2, () => ({ tracking: false }));
    expect(p.session().updates).toBe(updates);
    h.run(0.4, () => ({ tracking: true }));
    expect(h.engine.phase).toBe('paused');
    h.run(0.3);
    expect(h.engine.phase).toBe('playing');
    expect(p.session().resumes).toBe(1);
    // A pause for tracking is not the user's to end.
    h.run(0.1, () => ({ tracking: false }));
    h.engine.togglePause();
    expect(h.engine.phase).toBe('paused');
  });

  it('gone for over 3 s: re-locks, takes a new base pose, then resumes the same session', () => {
    const h = new Harness();
    const p = probeModule();
    h.start(p.module, 0);
    toPlay(h);
    const session = p.session();
    h.run(4, () => ({ tracking: false }));
    expect(h.engine.phase).toBe('paused');
    expect(h.engine.tracker.getBase()).toBeNull();
    h.run(1, () => ({ tracking: true }));
    expect(h.engine.phase).toBe('paused');
    expect(h.engine.view().message).toBe('Stand still so I can see you');
    h.until(() => h.engine.phase === 'playing', 4);
    expect(h.engine.phase).toBe('playing');
    expect(p.session()).toBe(session);
  });

  it('Pause and Resume from the button', () => {
    const h = new Harness();
    const p = probeModule();
    h.start(p.module, 0);
    toPlay(h);
    h.engine.togglePause();
    expect(h.engine.view()).toMatchObject({ phase: 'paused', pauseKind: 'user' });
    h.run(1);
    expect(h.engine.phase).toBe('paused');
    h.engine.togglePause();
    expect(h.engine.phase).toBe('playing');
  });

  it('a safety pause the game asks for holds until Resume', () => {
    const h = new Harness();
    const p = probeModule();
    h.start(p.module, 0);
    toPlay(h);
    p.session().pauseRequest = 'Take a rest';
    h.run(0.1);
    expect(h.engine.view()).toMatchObject({ phase: 'paused', pauseKind: 'safety', message: 'Take a rest' });
    h.run(3);
    expect(h.engine.phase).toBe('paused');
    h.engine.togglePause();
    expect(h.engine.phase).toBe('playing');
  });
});

describe('wrong view', () => {
  it('side-view squat: the base waits with "Turn sideways" while the patient faces the mirror', () => {
    const h = new Harness();
    h.start(squatModule, 0, { view: 'side' });
    h.run(6);
    expect(h.engine.phase).toBe('base');
    expect(h.engine.view().message).toBe('Turn sideways');
    toPlay(h, () => ({ view: 'side' }));
    expect(h.engine.phase).toBe('playing');
  });

  it('turning to face the mirror during side-view play pauses with "Turn sideways", then resumes', () => {
    const h = new Harness({}, { view: 'side' });
    h.start(squatModule, 0, { view: 'side' });
    toPlay(h);
    h.run(1);
    h.run(0.5, () => ({ view: 'front' }));
    expect(h.engine.view()).toMatchObject({ phase: 'paused', pauseKind: 'tracking', message: 'Turn sideways' });
    h.run(2);
    expect(h.engine.view().message).toBe('Turn sideways');
    h.run(1, () => ({ view: 'side' }));
    expect(h.engine.phase).toBe('playing');
  });

  it('turning sideways during a front-view game pauses with "Face the mirror"', () => {
    const h = new Harness();
    h.start(marchModule, 0);
    toPlay(h);
    h.run(0.5, () => ({ view: 'side' }));
    expect(h.engine.view()).toMatchObject({ phase: 'paused', message: 'Face the mirror' });
    h.run(1, () => ({ view: 'front' }));
    expect(h.engine.phase).toBe('playing');
  });
});

describe('Hurts, Exit and completion', () => {
  const phases = ['base', 'countdown', 'playing', 'paused'] as const;
  for (const phase of phases) {
    it(`Hurts during ${phase} ends the session at once, logs it, and gives no stars`, () => {
      const h = new Harness();
      const p = probeModule();
      h.start(p.module, 2);
      if (phase !== 'base') h.until(() => h.engine.phase === 'countdown', 4);
      if (phase === 'playing' || phase === 'paused') toPlay(h);
      if (phase === 'paused') h.engine.togglePause();
      expect(h.engine.phase).toBe(phase);
      h.engine.hurts();
      expect(h.engine.phase).toBe('finished');
      expect(h.ends).toHaveLength(1);
      expect(h.ends[0]).toMatchObject({ endedBy: 'hurts', result: { stars: 0 } });
      expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ endedBy: 'hurts', hurtsPresses: 1, gameId: 'probe', level: 'P3' }));
      expect(recordStars).not.toHaveBeenCalled();
    });
  }

  it('Hurts works at the bottom of a deep squat', () => {
    const h = new Harness();
    h.start(squatModule, 4);
    toPlay(h);
    h.run(3, (t) => ({ hipDropPct: Math.min(55, t * 25) }));
    expect(h.engine.canUseHoverMenu()).toBe(false);
    h.engine.hurts();
    expect(h.ends[0]?.endedBy).toBe('hurts');
  });

  it('Exit is one call; it logs the session only once play has started', () => {
    const h = new Harness();
    const p = probeModule();
    h.start(p.module, 0);
    h.run(1);
    h.engine.exit();
    expect(h.engine.phase).toBe('idle');
    expect(saveSession).not.toHaveBeenCalled();
    h.start(p.module, 0);
    toPlay(h);
    h.run(1);
    h.engine.exit();
    expect(h.engine.phase).toBe('idle');
    expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ endedBy: 'exit', stars: 0 }));
  });

  it('a finished game saves the session and its stars per game and level', () => {
    const h = new Harness();
    const p = probeModule();
    h.start(p.module, 1);
    toPlay(h);
    p.session().finished = true;
    h.run(0.1);
    expect(h.ends[0]).toMatchObject({ endedBy: 'complete', result: { stars: 3, score: 42 } });
    expect(recordStars).toHaveBeenCalledWith('probe', 'P2', 3);
  });

  it('hover menus follow the game: off while squatting, on standing tall', () => {
    const h = new Harness();
    h.start(squatModule, 2);
    toPlay(h);
    h.run(0.5);
    expect(h.engine.canUseHoverMenu()).toBe(true);
    h.run(3, (t) => ({ hipDropPct: Math.min(40, t * 15) }));
    expect(h.engine.canUseHoverMenu()).toBe(false);
  });
});

describe('real games, end to end with the scripted demo', () => {
  function playDemo(module: GameModule, levelIndex: number, options = {}, maxSeconds = 400, settings = {}) {
    const h = new Harness(settings, { view: (options as { view?: 'front' | 'side' }).view ?? 'front' });
    h.start(module, levelIndex, options);
    toPlay(h);
    h.demo = true;
    h.until(() => h.ends.length > 0, maxSeconds);
    return h;
  }

  it('Fruit Catcher F1: two full sets with the rest, all reps counted, 3 stars', () => {
    const h = playDemo(squatModule, 0);
    expect(h.ends[0]).toMatchObject({ endedBy: 'complete' });
    expect(h.ends[0].result.stars).toBe(3);
    expect(h.ends[0].result.numbers.find((n) => n.label === 'Reps')?.value).toBe('16/16');
  });

  it('Fruit Catcher S4 hip bias (side view): completes with 3 stars', () => {
    const h = playDemo(squatModule, 3, { view: 'side', style: 'hipBias' });
    expect(h.ends[0]).toMatchObject({ endedBy: 'complete' });
    expect(h.ends[0].result.stars).toBe(3);
  });

  it('Cross-Over Bubbles L5 (dual task, Ready confirm, marching): a full 3 minute round', () => {
    const h = playDemo(bubblesModule, 4);
    expect(h.ends[0]).toMatchObject({ endedBy: 'complete' });
    expect(h.ends[0].result.stars).toBeGreaterThanOrEqual(2);
    expect(h.ends[0].result.metrics.marchCadence).toBeGreaterThan(60);
  });

  for (const level of [0, 4]) {
    it(`March to the Beat L${level + 1}: the demo clears every bar`, () => {
      const h = playDemo(marchModule, level);
      expect(h.ends[0]).toMatchObject({ endedBy: 'complete' });
      expect(h.ends[0].result.numbers.find((n) => n.label === 'Bars cleared')?.value).toBe('100%');
    });
  }

  it('Cross-Over Bubbles: tracking lost freezes the round timer', () => {
    const h = new Harness();
    h.start(bubblesModule, 1);
    toPlay(h);
    h.run(10);
    const ring = h.engine.view().hud!.ring;
    h.run(8, () => ({ tracking: false }));
    expect(h.engine.phase).toBe('paused');
    expect(h.engine.view().hud!.ring).toBe(ring);
    // Over 3 s gone: a new base pose first, then play continues.
    let played = 0;
    h.until(() => h.engine.phase === 'playing', 5, () => ({ tracking: true }));
    expect(h.engine.phase).toBe('playing');
    h.run(1);
    played += 1;
    // Only the time actually played comes off the 180 s round.
    expect((ring - h.engine.view().hud!.ring) * 180).toBeLessThan(played + 0.1);
  });
});

describe('March to the Beat: song clock, pause and latency', () => {
  /** Steps exactly on the beat in true body time, from the session's bars and the song clock. */
  function onBeat(h: Harness) {
    return (): Partial<MockParams> => {
      const game = (h.engine.session as unknown as { game: { bars: { leg: 'left' | 'right'; arrival: number; height: number }[] } } | null)?.game;
      const now = h.audio.songTime();
      const lift = { left: 0, right: 0 };
      for (const bar of game?.bars ?? []) {
        const k = (now - bar.arrival) / 0.33;
        if (Math.abs(k) < 1) lift[bar.leg] = Math.max(lift[bar.leg], (bar.height + 6) * Math.cos((k * Math.PI) / 2));
      }
      return { leftFootLift: lift.left, rightFootLift: lift.right };
    };
  }

  function judgements(h: Harness, seconds: number, body: () => Partial<MockParams>): string[] {
    const seen: string[] = [];
    let last: unknown = null;
    for (let i = 0; i < seconds / DT; i += 1) {
      h.step(body());
      const lj = (h.engine.session as unknown as { game: { lastJudgement: { result: string; at: number } | null } } | null)?.game.lastJudgement ?? null;
      if (lj && lj !== last) {
        seen.push(lj.result);
        last = lj;
      }
    }
    return seen;
  }

  it('the camera latency setting moves the judged time: matched latency is PERFECT, ignored latency is late', () => {
    const delayed = (latencyMs: number) => {
      const h = new Harness({ cameraLatencyMs: latencyMs });
      h.start(marchModule, 0);
      toPlay(h);
      h.cameraDelayFrames = 6; // 200 ms camera delay
      return judgements(h, 30, onBeat(h));
    };
    const matched = delayed(200);
    expect(matched.length).toBeGreaterThan(8);
    expect(matched.every((r) => r === 'PERFECT')).toBe(true);
    const ignored = delayed(0);
    expect(ignored.length).toBeGreaterThan(8);
    expect(ignored.every((r) => r === 'GOOD')).toBe(true);
  });

  it('tracking lost pauses the music and the bars; after it comes back the bars are still on the beat', () => {
    const h = new Harness({ cameraLatencyMs: 0 });
    h.start(marchModule, 1);
    toPlay(h);
    const body = onBeat(h);
    const before = judgements(h, 15, body);
    h.run(4, () => ({ tracking: false }));
    expect(h.engine.phase).toBe('paused');
    expect(h.audio.paused).toBe(true);
    const song = h.audio.songTime();
    h.run(6, () => ({ tracking: false }));
    expect(h.audio.songTime()).toBe(song);
    const after = judgements(h, 20, () => ({ tracking: true, ...body() }));
    expect(h.audio.paused).toBe(false);
    expect(before.every((r) => r === 'PERFECT')).toBe(true);
    // Bars that were already on their way when tracking dropped are judged as they pass; after that, every step lands.
    expect(after.slice(-6).every((r) => r === 'PERFECT')).toBe(true);
    expect(h.engine.view().message).not.toBe('Take a rest');
  });
});
