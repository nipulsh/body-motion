/**
 * WebAudio only: synthesised effects and a lookahead beat scheduler on the
 * AudioContext clock for rhythm games. No sound files (an optional mp3 track
 * can be played in sync for March to the Beat).
 */

type Wave = OscillatorType;

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

export interface TrackOptions {
  bpm: number;
  /** Optional decoded music to play instead of the procedural beat. */
  buffer?: AudioBuffer | null;
  /** Seconds into the buffer that line up with song time 0. */
  bufferOffset?: number;
}

export class RehabAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private trackTimer: number | null = null;
  private trackStart = 0;
  /** Tempo on the song clock: from each `from` (song seconds) the beat runs at `bpm`. */
  private tempo: { from: number; bpm: number }[] = [{ from: 0, bpm: 60 }];
  /** Count and song time of the next beat not yet scheduled. */
  private nextBeat = 0;
  private nextBeatSong = 0;
  private trackSource: AudioBufferSourceNode | null = null;

  /** Output delay in seconds applied to the song clock (audio offset setting). */
  audioOffset = 0;

  ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  /** Call from a user gesture where possible; browsers start audio suspended. */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended' && !this.paused) void ctx.resume().catch(() => {});
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  get now(): number {
    return this.ctx?.currentTime ?? performance.now() / 1000;
  }

  private paused = false;

  /** Freeze the AudioContext clock (pause) or continue it. */
  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (paused && ctx.state === 'running') await ctx.suspend();
      if (!paused && ctx.state === 'suspended') await ctx.resume();
    } catch {
      // Ignore: the clock keeps its last state.
    }
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; when?: number; slideTo?: number; attack?: number } = {}): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = opts.when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    const peak = opts.gain ?? 0.3;
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noiseBurst(dur: number, opts: { when?: number; gain?: number; highpass?: number; lowpass?: number } = {}): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const t0 = opts.when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.highpass ? 'highpass' : 'lowpass';
    filter.frequency.value = opts.highpass ?? opts.lowpass ?? 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** Soft pop; `pitch` 0 (low) .. 1 (high). */
  pop(pitch = 0.5): void {
    const f = 380 + pitch * 420;
    this.tone(f, 0.12, { type: 'sine', gain: 0.35, slideTo: f * 1.8 });
  }

  chime(): void {
    this.tone(880, 0.5, { type: 'triangle', gain: 0.2 });
    this.tone(1320, 0.6, { type: 'sine', gain: 0.12, when: (this.ctx?.currentTime ?? 0) + 0.08 });
  }

  buzz(): void {
    this.tone(110, 0.22, { type: 'square', gain: 0.08 });
  }

  lowTone(): void {
    this.tone(150, 0.4, { type: 'triangle', gain: 0.25, slideTo: 90 });
  }

  thud(): void {
    this.tone(90, 0.18, { type: 'sine', gain: 0.4, slideTo: 50 });
    this.noiseBurst(0.08, { lowpass: 400, gain: 0.15 });
  }

  whoosh(): void {
    this.noiseBurst(0.3, { highpass: 1800, gain: 0.12 });
  }

  countdown(final: boolean): void {
    this.tone(final ? 880 : 520, final ? 0.35 : 0.15, { type: 'sine', gain: 0.25 });
  }

  celebrate(): void {
    const t = this.ctx?.currentTime ?? 0;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.18, when: t + i * 0.09 }));
  }

  // ---- Beat track ---------------------------------------------------------

  /** Song time (seconds) since the track's beat zero, after the audio offset. */
  songTime(): number {
    if (!this.ctx) return 0;
    return this.ctx.currentTime - this.trackStart - this.audioOffset;
  }

  /** Start the track so song time 0 lands `leadIn` seconds from now. */
  startTrack(options: TrackOptions, leadIn = 0.1): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.stopTrack();
    this.trackStart = ctx.currentTime + leadIn;
    this.tempo = [{ from: 0, bpm: options.bpm }];
    this.nextBeat = 0;
    this.nextBeatSong = 0;
    if (options.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = options.buffer;
      src.connect(this.master!);
      src.start(this.trackStart, Math.max(0, options.bufferOffset ?? 0));
      this.trackSource = src;
      return;
    }
    const tick = () => this.scheduleBeats();
    tick();
    this.trackTimer = window.setInterval(tick, TICK_MS);
  }

  /**
   * Change tempo from song time `fromSong` on (default: the next unscheduled
   * beat). The song clock never jumps: beats already scheduled keep their time,
   * and a beat lands exactly on `fromSong`, where the game's bars switch too.
   */
  setTrackBpm(bpm: number, fromSong?: number): void {
    if (!this.ctx || bpm <= 0) return;
    const from = Math.max(fromSong ?? this.nextBeatSong, this.nextBeatSong);
    this.tempo = [...this.tempo.filter((s) => s.from < from - 1e-9), { from, bpm }];
  }

  private bpmAt(song: number): number {
    let bpm = this.tempo[0].bpm;
    for (const s of this.tempo) if (song >= s.from - 1e-6) bpm = s.bpm;
    return bpm;
  }

  /** Song time of the beat after `song`, landing exactly on any tempo change in between. */
  private beatAfter(song: number): number {
    const next = song + 60 / this.bpmAt(song);
    const change = this.tempo.find((s) => s.from > song + 1e-6 && s.from < next - 1e-6);
    return change ? change.from : next;
  }

  private scheduleBeats(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.trackStart + this.nextBeatSong < ctx.currentTime + LOOKAHEAD_S) {
      const when = this.trackStart + this.nextBeatSong;
      const beatSec = 60 / this.bpmAt(this.nextBeatSong);
      if (when >= ctx.currentTime - 0.01) {
        const n = this.nextBeat;
        // Kick on every beat.
        this.tone(130, 0.18, { type: 'sine', gain: 0.55, when, slideTo: 45, attack: 0.002 });
        // Hi-hat on the off-beat.
        this.noiseBurst(0.05, { when: when + beatSec / 2, highpass: 7000, gain: 0.08 });
        // Bass: root, root, fifth, octave.
        const notes = [55, 55, 82.4, 110];
        this.tone(notes[n % 4], beatSec * 0.45, { type: 'triangle', gain: 0.16, when: when + 0.01 });
      }
      this.nextBeat += 1;
      this.nextBeatSong = this.beatAfter(this.nextBeatSong);
    }
  }

  stopTrack(): void {
    if (this.trackTimer !== null) window.clearInterval(this.trackTimer);
    this.trackTimer = null;
    try {
      this.trackSource?.stop();
    } catch {
      // already stopped
    }
    this.trackSource = null;
  }

  async loadBuffer(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ensure();
    if (!ctx) return null;
    try {
      const res = await fetch(url);
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.stopTrack();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close().catch(() => {});
  }
}
