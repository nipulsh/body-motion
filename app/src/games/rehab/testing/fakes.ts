/**
 * Test support (not a test). Stand-ins for the browser-only parts of the rehab
 * core, so the real engine and game sessions run under Vitest in Node.
 */

/** Wall clock for `performance.now()`, moved by the harness. */
export const clock = { ms: 0 };

interface TrackOptions {
  bpm: number;
}

/**
 * The AudioContext clock the March game times against. It only advances while
 * not paused, like a suspended AudioContext. Sounds are recorded by name.
 */
export class FakeAudio {
  static instances: FakeAudio[] = [];
  audioOffset = 0;
  muted = false;
  paused = false;
  /** AudioContext.currentTime. */
  currentTime = 0;
  trackStart = 0;
  trackBpm = 60;
  sounds: string[] = [];

  constructor() {
    FakeAudio.instances.push(this);
  }

  advance(seconds: number): void {
    if (!this.paused) this.currentTime += seconds;
  }

  get now(): number {
    return this.currentTime;
  }

  ensure(): null {
    return null;
  }

  unlock(): void {}

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
  }

  songTime(): number {
    return this.currentTime - this.trackStart - this.audioOffset;
  }

  startTrack(options: TrackOptions, leadIn = 0.1): void {
    this.trackStart = this.currentTime + leadIn;
    this.trackBpm = options.bpm;
  }

  setTrackBpm(bpm: number): void {
    this.trackBpm = bpm;
  }

  stopTrack(): void {}

  async loadBuffer(): Promise<null> {
    return null;
  }

  dispose(): void {}

  private sound(name: string): void {
    this.sounds.push(name);
  }

  pop(): void {
    this.sound('pop');
  }
  chime(): void {
    this.sound('chime');
  }
  buzz(): void {
    this.sound('buzz');
  }
  lowTone(): void {
    this.sound('lowTone');
  }
  thud(): void {
    this.sound('thud');
  }
  whoosh(): void {
    this.sound('whoosh');
  }
  countdown(final: boolean): void {
    this.sound(final ? 'go' : 'beep');
  }
  celebrate(): void {
    this.sound('celebrate');
  }
}

/** THREE.WebGLRenderer without a GPU: the real RehabRenderer layout still runs. */
export class FakeWebGLRenderer {
  outputColorSpace = '';
  private pixelRatio = 1;
  setClearColor(): void {}
  getPixelRatio(): number {
    return this.pixelRatio;
  }
  setPixelRatio(r: number): void {
    this.pixelRatio = r;
  }
  setSize(): void {}
  render(): void {}
  dispose(): void {}
}
