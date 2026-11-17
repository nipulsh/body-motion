import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RehabAudio } from './audio';

/** Just enough of the WebAudio API to watch the beat scheduler. Kicks are the 130 Hz tones. */
class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 0;
  state: 'running' | 'suspended' = 'running';
  sampleRate = 8000;
  destination = {};
  kicks: number[] = [];
  constructor() {
    FakeContext.last = this;
  }
  private param() {
    const ctx = this;
    return {
      value: 0,
      setValueAtTime(v: number, t: number) {
        if (v === 130) ctx.kicks.push(t);
        return this;
      },
      exponentialRampToValueAtTime() {
        return this;
      },
      linearRampToValueAtTime() {
        return this;
      },
      setTargetAtTime() {
        return this;
      },
    };
  }
  private node() {
    return { connect: (n: unknown) => n, disconnect() {} };
  }
  createGain() {
    return { ...this.node(), gain: this.param() };
  }
  createOscillator() {
    return { ...this.node(), type: 'sine', frequency: this.param(), start() {}, stop() {} };
  }
  createBufferSource() {
    return { ...this.node(), buffer: null, start() {}, stop() {} };
  }
  createBiquadFilter() {
    return { ...this.node(), type: 'lowpass', frequency: this.param() };
  }
  createBuffer(_c: number, len: number) {
    const data = new Float32Array(len);
    return { getChannelData: () => data };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {}
}

let tick: (() => void) | null = null;

beforeEach(() => {
  tick = null;
  vi.stubGlobal('window', {
    AudioContext: FakeContext,
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {},
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Advance the AudioContext clock in scheduler ticks. */
function advance(seconds: number) {
  const ctx = FakeContext.last!;
  for (let i = 0; i < Math.round(seconds / 0.025); i += 1) {
    ctx.currentTime += 0.025;
    tick?.();
  }
}

describe('beat track', () => {
  it('schedules a kick on every beat of the song clock', () => {
    const audio = new RehabAudio();
    audio.startTrack({ bpm: 80 }, 0.15);
    advance(10);
    const ctx = FakeContext.last!;
    const song = ctx.kicks.map((k) => k - (ctx.currentTime - audio.songTime()));
    song.forEach((s, i) => expect(s).toBeCloseTo(i * 0.75, 6));
  });

  it('a tempo change keeps the song clock continuous and switches the beat at the song time asked for', () => {
    const audio = new RehabAudio();
    audio.startTrack({ bpm: 80 }, 0.15);
    advance(30);
    const ctx = FakeContext.last!;
    const before = audio.songTime();
    // The game's next bar arrives at song time 33.0 (a beat at 80 BPM); from there on, 70 BPM.
    audio.setTrackBpm(70, 33);
    expect(audio.songTime()).toBeCloseTo(before, 9);
    advance(10);
    const zero = ctx.currentTime - audio.songTime();
    const song = ctx.kicks.map((k) => k - zero);
    const at33 = song.findIndex((s) => Math.abs(s - 33) < 1e-6);
    expect(at33).toBeGreaterThan(0);
    for (let i = 1; i <= at33; i += 1) expect(song[i] - song[i - 1]).toBeCloseTo(0.75, 6);
    for (let i = at33 + 1; i < song.length; i += 1) expect(song[i] - song[i - 1]).toBeCloseTo(60 / 70, 6);
  });

  it('pausing freezes the song clock (the AudioContext is suspended)', async () => {
    const audio = new RehabAudio();
    audio.startTrack({ bpm: 60 }, 0.1);
    advance(5);
    await audio.setPaused(true);
    expect(FakeContext.last!.state).toBe('suspended');
    await audio.setPaused(false);
    expect(FakeContext.last!.state).toBe('running');
  });
});
